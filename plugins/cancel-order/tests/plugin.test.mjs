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
  let approvalId = 0
  const state = new CustomerStateService(base, {
    clock,
    idFactory: () => `EVENT-${++eventId}`,
  })
  const approval = new CustomerApprovalService(base, {
    clock,
    idFactory: () => `${approvalId++ % 2 === 0 ? 'CONFIRM' : 'AUDIT'}-${Math.ceil(approvalId / 2)}`,
  })
  const published = []
  const events = new CustomerEventsService(base, { clock, resolveAgent: () => undefined })
  events.subscribe({ sessionId: 'SESSION-A', alertType: 'delivery', targetId: 'ORDER-1002' })
  events.registerMatcher('delivery', (event) => {
    published.push(event)
    return []
  })
  const tools = new Map()
  apply({
    customerState: state,
    customerApproval: approval,
    customerEvents: events,
    tools: { register(tool) { tools.set(tool.name, tool) } },
  })
  return { approval, clock, published, state, tools }
}

describe('cancel order plugin', () => {
  it('registers strict request and confirmation tools', () => {
    const { tools } = createFixture()
    expect(name).toBe('customer-cancel-order')
    expect(inject).toEqual(['tools', 'customerState', 'customerApproval', 'customerEvents'])
    expect([...tools.keys()]).toEqual(['request_cancel_order', 'confirm_cancel_order'])
    expect(tools.get('request_cancel_order').parameters).toMatchObject({
      additionalProperties: false,
      required: ['orderId', 'reason'],
    })
    expect(tools.get('confirm_cancel_order').parameters).toMatchObject({
      additionalProperties: false,
      required: ['confirmationId'],
    })
  })

  it('returns business rejections without issuing a confirmation', async () => {
    const { tools } = createFixture()
    await expect(tools.get('request_cancel_order').execute({
      orderId: 'missing', reason: '不需要了',
    })).resolves.toEqual({
      accepted: false,
      code: 'ORDER_NOT_FOUND',
      message: '未找到订单 MISSING。',
    })
    await expect(tools.get('request_cancel_order').execute({
      orderId: 'order-1001', reason: '不需要了',
    })).resolves.toEqual({
      accepted: false,
      code: 'ORDER_ALREADY_SHIPPED',
      message: '订单 ORDER-1001 当前状态不允许取消。',
    })
  })

  it('issues a normalized confirmation without changing the order', async () => {
    const { approval, state, tools } = createFixture()
    const result = await tools.get('request_cancel_order').execute({
      orderId: ' order-1002 ', reason: ' 不需要了 ',
    })
    expect(result).toEqual({
      accepted: true,
      action: 'cancel_order',
      orderId: 'ORDER-1002',
      confirmationId: 'CONFIRM-1',
      expiresAt: '2026-08-27T04:10:00.000Z',
      summary: '确认取消订单 ORDER-1002，原因：不需要了。确认编号：CONFIRM-1。',
    })
    expect(tools.get('request_cancel_order').output.render({}, result)[0].text)
      .toContain('CONFIRM-1')
    expect(state.getOrder('ORDER-1002')).toMatchObject({ status: 'processing', version: 1 })
    expect(approval.validate('CONFIRM-1', 'cancel_order')).toMatchObject({
      valid: true,
      targetId: 'ORDER-1002',
      payload: { reason: '不需要了' },
    })
  })

  it('revalidates changed state before applying', async () => {
    const { state, tools } = createFixture()
    const requested = await tools.get('request_cancel_order').execute({
      orderId: 'ORDER-1002', reason: '不需要了',
    })
    await state.updateOrder('ORDER-1002', () => ({ status: 'shipped' }))
    await expect(tools.get('confirm_cancel_order').execute({
      confirmationId: requested.confirmationId,
    })).resolves.toEqual({
      applied: false,
      code: 'ORDER_ALREADY_SHIPPED',
      message: '订单 ORDER-1002 当前状态不允许取消。',
    })
  })

  it('applies once, publishes the event, records audit, and replays idempotently', async () => {
    const { approval, published, state, tools } = createFixture()
    const requested = await tools.get('request_cancel_order').execute({
      orderId: 'ORDER-1002', reason: '不需要了',
    })
    const [first, second] = await Promise.all([
      tools.get('confirm_cancel_order').execute({ confirmationId: requested.confirmationId }),
      tools.get('confirm_cancel_order').execute({ confirmationId: requested.confirmationId }),
    ])

    expect(first).toEqual({
      applied: true,
      action: 'cancel_order',
      orderId: 'ORDER-1002',
      confirmationId: 'CONFIRM-1',
      auditId: 'AUDIT-1',
      alreadyApplied: false,
      message: '订单 ORDER-1002 已取消。',
    })
    expect(second).toEqual({ ...first, alreadyApplied: true })
    expect(state.getOrder('ORDER-1002')).toMatchObject({ status: 'cancelled', version: 2 })
    expect(published).toHaveLength(1)
    expect(approval.getAudit('AUDIT-1')).toMatchObject({
      action: 'cancel_order',
      before: { status: 'processing' },
      after: { status: 'cancelled' },
    })
  })

  it('wraps internal failures without exposing their details', async () => {
    const { state, tools } = createFixture()
    state.getOrder = () => { throw new Error('/private/customer.db is locked') }
    const promise = tools.get('request_cancel_order').execute({
      orderId: 'ORDER-1002', reason: '不需要了',
    })
    await expect(promise).rejects.toMatchObject({
      message: '取消订单服务暂时不可用，请稍后重试。',
      cause: { message: '/private/customer.db is locked' },
    })
  })

  it('allows only one of two concurrent cancellation confirmations', async () => {
    const { state, tools } = createFixture()
    const firstRequest = await tools.get('request_cancel_order').execute({
      orderId: 'ORDER-1002', reason: '第一次取消',
    })
    const secondRequest = await tools.get('request_cancel_order').execute({
      orderId: 'ORDER-1002', reason: '第二次取消',
    })
    const results = await Promise.all([
      tools.get('confirm_cancel_order').execute({ confirmationId: firstRequest.confirmationId }),
      tools.get('confirm_cancel_order').execute({ confirmationId: secondRequest.confirmationId }),
    ])

    expect(results.filter((result) => result.applied)).toHaveLength(1)
    expect(results.filter((result) => !result.applied)).toMatchObject([
      { code: 'ORDER_ALREADY_SHIPPED' },
    ])
    expect(state.getOrder('ORDER-1002')).toMatchObject({ status: 'cancelled', version: 2 })
  })

  it('returns deterministic confirmation errors', async () => {
    const { tools } = createFixture()
    await expect(tools.get('confirm_cancel_order').execute({ confirmationId: 'missing' }))
      .resolves.toEqual({
        applied: false,
        code: 'CONFIRMATION_NOT_FOUND',
        message: '确认编号不存在。',
      })
  })
})
