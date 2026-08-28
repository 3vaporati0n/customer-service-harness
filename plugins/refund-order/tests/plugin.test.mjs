import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { CustomerApprovalService } from '@dsh-customer-service/approval'
import { MutableClock } from '@dsh-customer-service/domain'
import { CustomerEventsService } from '@dsh-customer-service/events'
import { CustomerStateService } from '@dsh-customer-service/state'
import { apply, inject, name } from '../src/index.ts'

function createFixture() {
  const base = new Context()
  const clock = new MutableClock('2026-08-27T12:00:00+08:00')
  let eventId = 0
  const approvalIds = ['CONFIRM-1', 'AUDIT-1', 'CONFIRM-2', 'AUDIT-2']
  const state = new CustomerStateService(base, {
    clock, idFactory: () => `EVENT-${++eventId}`,
  })
  const approval = new CustomerApprovalService(base, {
    clock, idFactory: () => approvalIds.shift(),
  })
  const published = []
  const events = new CustomerEventsService(base, { clock, resolveAgent: () => undefined })
  events.subscribe({ sessionId: 'SESSION-A', alertType: 'refund_progress', targetId: 'REFUND-NEW-1' })
  events.registerMatcher('refund_progress', (event) => { published.push(event); return [] })
  const tools = new Map()
  let refundNumber = 0
  apply({
    customerState: state, customerApproval: approval, customerEvents: events,
    tools: { register(tool) { tools.set(tool.name, tool) } },
  }, { idFactory: () => `REFUND-NEW-${++refundNumber}` })
  return { approval, published, state, tools }
}

describe('refund order plugin', () => {
  it('registers strict tools and never accepts a user amount', () => {
    const { tools } = createFixture()
    expect(name).toBe('customer-refund-order')
    expect(inject).toEqual(['tools', 'customerState', 'customerApproval', 'customerEvents'])
    expect([...tools.keys()]).toEqual(['request_refund', 'confirm_refund'])
    expect(tools.get('request_refund').parameters).toMatchObject({
      additionalProperties: false, required: ['orderId', 'reason'],
    })
    expect(tools.get('request_refund').parameters.properties.amount).toBeUndefined()
  })

  it('rejects unknown and ineligible orders', async () => {
    const { tools } = createFixture()
    await expect(tools.get('request_refund').execute({
      orderId: 'missing', reason: '退款',
    })).resolves.toMatchObject({ accepted: false, code: 'ORDER_NOT_FOUND' })
    await expect(tools.get('request_refund').execute({
      orderId: 'ORDER-1002', reason: '退款',
    })).resolves.toMatchObject({ accepted: false, code: 'REFUND_NOT_ELIGIBLE' })
    await expect(tools.get('request_refund').execute({
      orderId: 'ORDER-1003', reason: '退款',
    })).resolves.toMatchObject({ accepted: false, code: 'REFUND_NOT_ELIGIBLE' })
  })

  it('derives the full amount for a cancelled order', async () => {
    const { approval, state, tools } = createFixture()
    await state.updateOrder('ORDER-1002', () => ({ status: 'cancelled' }))
    const result = await tools.get('request_refund').execute({
      orderId: ' order-1002 ', reason: ' 不需要了 ',
    })
    expect(result).toMatchObject({
      accepted: true, action: 'refund_order', orderId: 'ORDER-1002',
      refundId: 'REFUND-NEW-1', amount: 399, confirmationId: 'CONFIRM-1',
    })
    expect(tools.get('request_refund').output.render({}, result)[0].text)
      .toContain('CONFIRM-1')
    expect(approval.validate('CONFIRM-1', 'refund_order')).toMatchObject({
      valid: true,
      payload: { refundId: 'REFUND-NEW-1', amount: 399, reason: '不需要了' },
    })
  })

  it('uses an approved return, rejects active refunds, and allows retry after failure', async () => {
    const active = createFixture()
    await active.state.createReturn({
      returnId: 'RETURN-A', orderId: 'ORDER-1003', reason: '退货', status: 'approved',
    })
    await active.state.createRefund({
      refundId: 'REFUND-A', orderId: 'ORDER-1003', returnId: 'RETURN-A',
      amount: 258, reason: '退款', status: 'processing',
    })
    await expect(active.tools.get('request_refund').execute({
      orderId: 'ORDER-1003', reason: '再次退款',
    })).resolves.toMatchObject({ accepted: false, code: 'REFUND_ALREADY_EXISTS' })

    const retry = createFixture()
    await retry.state.createReturn({
      returnId: 'RETURN-A', orderId: 'ORDER-1003', reason: '退货', status: 'received',
    })
    await retry.state.createRefund({
      refundId: 'REFUND-FAILED', orderId: 'ORDER-1003', returnId: 'RETURN-A',
      amount: 258, reason: '第一次', status: 'failed',
    })
    const result = await retry.tools.get('request_refund').execute({
      orderId: 'ORDER-1003', reason: '再次退款',
    })
    expect(result).toMatchObject({
      accepted: true, returnId: 'RETURN-A', amount: 258, refundId: 'REFUND-NEW-1',
    })
  })

  it('revalidates a race before creating a refund', async () => {
    const { state, tools } = createFixture()
    await state.updateOrder('ORDER-1002', () => ({ status: 'cancelled' }))
    const request = await tools.get('request_refund').execute({
      orderId: 'ORDER-1002', reason: '退款',
    })
    await state.createRefund({
      refundId: 'REFUND-RACE', orderId: 'ORDER-1002', amount: 399,
      reason: '并发退款', status: 'pending',
    })
    await expect(tools.get('confirm_refund').execute({
      confirmationId: request.confirmationId,
    })).resolves.toMatchObject({ applied: false, code: 'REFUND_ALREADY_EXISTS' })
  })

  it('creates one pending refund, publishes, audits, and replays idempotently', async () => {
    const { approval, published, state, tools } = createFixture()
    await state.createReturn({
      returnId: 'RETURN-A', orderId: 'ORDER-1003', reason: '退货', status: 'approved',
    })
    const request = await tools.get('request_refund').execute({
      orderId: 'ORDER-1003', reason: '退货退款',
    })
    const [first, second] = await Promise.all([
      tools.get('confirm_refund').execute({ confirmationId: request.confirmationId }),
      tools.get('confirm_refund').execute({ confirmationId: request.confirmationId }),
    ])
    expect(first).toMatchObject({
      applied: true, action: 'refund_order', orderId: 'ORDER-1003',
      refundId: 'REFUND-NEW-1', returnId: 'RETURN-A', amount: 258,
      status: 'pending', auditId: 'AUDIT-1', alreadyApplied: false,
    })
    expect(second).toEqual({ ...first, alreadyApplied: true })
    expect(state.getRefund('REFUND-NEW-1')).toMatchObject({
      orderId: 'ORDER-1003', returnId: 'RETURN-A', amount: 258,
      reason: '退货退款', status: 'pending', version: 1,
    })
    expect(published).toHaveLength(1)
    expect(approval.getAudit('AUDIT-1')).toMatchObject({ action: 'refund_order' })
  })

  it('wraps internal failures without exposing their details', async () => {
    const { state, tools } = createFixture()
    state.getOrder = () => { throw new Error('/private/customer.db is locked') }
    const promise = tools.get('request_refund').execute({
      orderId: 'ORDER-1002', reason: '退款',
    })
    await expect(promise).rejects.toMatchObject({
      message: '退款服务暂时不可用，请稍后重试。',
      cause: { message: '/private/customer.db is locked' },
    })
  })

  it('allows only one of two concurrent refund confirmations', async () => {
    const { state, tools } = createFixture()
    await state.updateOrder('ORDER-1002', () => ({ status: 'cancelled' }))
    const firstRequest = await tools.get('request_refund').execute({
      orderId: 'ORDER-1002', reason: '第一次退款',
    })
    const secondRequest = await tools.get('request_refund').execute({
      orderId: 'ORDER-1002', reason: '第二次退款',
    })
    const results = await Promise.all([
      tools.get('confirm_refund').execute({ confirmationId: firstRequest.confirmationId }),
      tools.get('confirm_refund').execute({ confirmationId: secondRequest.confirmationId }),
    ])

    expect(results.filter((result) => result.applied)).toHaveLength(1)
    expect(results.filter((result) => !result.applied)).toMatchObject([
      { code: 'REFUND_ALREADY_EXISTS' },
    ])
    expect(state.listRefundsByOrder('ORDER-1002')).toHaveLength(1)
  })
})
