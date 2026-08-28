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
  events.subscribe({ sessionId: 'SESSION-A', alertType: 'delivery', targetId: 'ORDER-1003' })
  events.registerMatcher('delivery', (event) => { published.push(event); return [] })
  const tools = new Map()
  let returnNumber = 0
  apply({
    customerState: state, customerApproval: approval, customerEvents: events,
    tools: { register(tool) { tools.set(tool.name, tool) } },
  }, { idFactory: () => `RETURN-NEW-${++returnNumber}` })
  return { approval, clock, published, state, tools }
}

describe('return order plugin', () => {
  it('registers strict request and confirmation tools', () => {
    const { tools } = createFixture()
    expect(name).toBe('customer-return-order')
    expect(inject).toEqual(['tools', 'customerState', 'customerApproval', 'customerEvents'])
    expect([...tools.keys()]).toEqual(['request_return_order', 'confirm_return_order'])
    expect(tools.get('request_return_order').parameters).toMatchObject({
      additionalProperties: false, required: ['orderId', 'reason'],
    })
  })

  it('returns deterministic eligibility rejections', async () => {
    const { state, tools } = createFixture()
    await expect(tools.get('request_return_order').execute({
      orderId: 'missing', reason: '不合适',
    })).resolves.toMatchObject({ accepted: false, code: 'ORDER_NOT_FOUND' })
    await expect(tools.get('request_return_order').execute({
      orderId: 'ORDER-1002', reason: '不合适',
    })).resolves.toMatchObject({ accepted: false, code: 'ORDER_NOT_DELIVERED' })
    await state.updateOrder('ORDER-1003', () => ({
      deliveredAt: '2026-08-20T03:59:59.999Z',
    }))
    await expect(tools.get('request_return_order').execute({
      orderId: 'ORDER-1003', reason: '不合适',
    })).resolves.toMatchObject({ accepted: false, code: 'RETURN_WINDOW_EXPIRED' })
  })

  it('accepts exactly seven days and allows retry after a rejected return', async () => {
    const { approval, state, tools } = createFixture()
    await state.updateOrder('ORDER-1003', () => ({
      deliveredAt: '2026-08-20T04:00:00.000Z',
    }))
    await state.createReturn({
      returnId: 'RETURN-OLD', orderId: 'ORDER-1003', reason: '第一次', status: 'rejected',
    })
    const result = await tools.get('request_return_order').execute({
      orderId: ' order-1003 ', reason: ' 不合适 ',
    })
    expect(result).toMatchObject({
      accepted: true, action: 'return_order', orderId: 'ORDER-1003',
      returnId: 'RETURN-NEW-1', confirmationId: 'CONFIRM-1',
    })
    expect(tools.get('request_return_order').output.render({}, result)[0].text)
      .toContain('CONFIRM-1')
    expect(approval.validate('CONFIRM-1', 'return_order')).toMatchObject({
      valid: true,
      payload: { returnId: 'RETURN-NEW-1', reason: '不合适' },
    })
  })

  it('rejects an active return during request and confirmation revalidation', async () => {
    const first = createFixture()
    await first.state.createReturn({
      returnId: 'RETURN-ACTIVE', orderId: 'ORDER-1003', reason: '第一次', status: 'approved',
    })
    await expect(first.tools.get('request_return_order').execute({
      orderId: 'ORDER-1003', reason: '第二次',
    })).resolves.toMatchObject({ accepted: false, code: 'RETURN_ALREADY_EXISTS' })

    const second = createFixture()
    const request = await second.tools.get('request_return_order').execute({
      orderId: 'ORDER-1003', reason: '第一次',
    })
    await second.state.createReturn({
      returnId: 'RETURN-RACE', orderId: 'ORDER-1003', reason: '并发申请', status: 'approved',
    })
    await expect(second.tools.get('confirm_return_order').execute({
      confirmationId: request.confirmationId,
    })).resolves.toMatchObject({ applied: false, code: 'RETURN_ALREADY_EXISTS' })
  })

  it('creates one approved return, publishes, audits, and replays idempotently', async () => {
    const { approval, published, state, tools } = createFixture()
    const request = await tools.get('request_return_order').execute({
      orderId: 'ORDER-1003', reason: '尺寸不合适',
    })
    const [first, second] = await Promise.all([
      tools.get('confirm_return_order').execute({ confirmationId: request.confirmationId }),
      tools.get('confirm_return_order').execute({ confirmationId: request.confirmationId }),
    ])
    expect(first).toMatchObject({
      applied: true, action: 'return_order', orderId: 'ORDER-1003',
      returnId: 'RETURN-NEW-1', status: 'approved', auditId: 'AUDIT-1',
      alreadyApplied: false,
    })
    expect(second).toEqual({ ...first, alreadyApplied: true })
    expect(state.getReturn('RETURN-NEW-1')).toMatchObject({
      orderId: 'ORDER-1003', reason: '尺寸不合适', status: 'approved', version: 1,
    })
    expect(published).toHaveLength(1)
    expect(approval.getAudit('AUDIT-1')).toMatchObject({ action: 'return_order' })
  })

  it('wraps internal failures without exposing their details', async () => {
    const { state, tools } = createFixture()
    state.getOrder = () => { throw new Error('/private/customer.db is locked') }
    const promise = tools.get('request_return_order').execute({
      orderId: 'ORDER-1003', reason: '不合适',
    })
    await expect(promise).rejects.toMatchObject({
      message: '退货服务暂时不可用，请稍后重试。',
      cause: { message: '/private/customer.db is locked' },
    })
  })

  it('allows only one of two concurrent return confirmations', async () => {
    const { state, tools } = createFixture()
    const firstRequest = await tools.get('request_return_order').execute({
      orderId: 'ORDER-1003', reason: '第一次申请',
    })
    const secondRequest = await tools.get('request_return_order').execute({
      orderId: 'ORDER-1003', reason: '第二次申请',
    })
    const results = await Promise.all([
      tools.get('confirm_return_order').execute({ confirmationId: firstRequest.confirmationId }),
      tools.get('confirm_return_order').execute({ confirmationId: secondRequest.confirmationId }),
    ])

    expect(results.filter((result) => result.applied)).toHaveLength(1)
    expect(results.filter((result) => !result.applied)).toMatchObject([
      { code: 'RETURN_ALREADY_EXISTS' },
    ])
    expect(state.listReturnsByOrder('ORDER-1003')).toHaveLength(1)
  })
})
