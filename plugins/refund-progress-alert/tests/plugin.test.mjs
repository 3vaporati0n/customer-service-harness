import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { MutableClock } from '@dsh-customer-service/domain'
import { CustomerEventsService } from '@dsh-customer-service/events'
import { CustomerStateService } from '@dsh-customer-service/state'
import { apply, inject, name } from '../src/index.ts'

async function createFixture() {
  const base = new Context()
  const messages = []
  let eventId = 0
  let subscriptionId = 0
  const state = new CustomerStateService(base, {
    clock: new MutableClock('2026-08-28T12:00:00+08:00'),
    idFactory: () => `EVENT-${++eventId}`,
  })
  await state.createRefund({
    refundId: 'REFUND-TEST-1',
    orderId: 'ORDER-1003',
    amount: 258,
    reason: '商品不合适',
    status: 'pending',
  })
  const events = new CustomerEventsService(base, {
    clock: state.clock,
    idFactory: () => `SUB-${++subscriptionId}`,
    resolveAgent: (sessionId) => ({
      followup(message) { messages.push({ sessionId, message }) },
    }),
  })
  const tools = new Map()
  apply({
    customerState: state,
    customerEvents: events,
    tools: { register(tool) { tools.set(tool.name, tool) } },
  })
  return { events, messages, state, tools }
}

const runContext = (sessionId) => ({ agent: { id: sessionId } })

describe('refund progress alert plugin', () => {
  it('registers one strict subscription tool with exact dependencies', async () => {
    const { tools } = await createFixture()
    expect(name).toBe('customer-refund-progress-alert')
    expect(inject).toEqual(['tools', 'customerState', 'customerEvents'])
    expect([...tools.keys()]).toEqual(['subscribe_refund_progress_alert'])
    expect(tools.get('subscribe_refund_progress_alert').parameters).toMatchObject({
      additionalProperties: false,
      required: ['refundId'],
    })
  })

  it('subscribes the current Harness session and deduplicates retries', async () => {
    const { events, tools } = await createFixture()
    const tool = tools.get('subscribe_refund_progress_alert')
    const first = await tool.execute(
      { refundId: ' refund-test-1 ' },
      runContext('SESSION-A'),
    )
    const second = await tool.execute(
      { refundId: 'REFUND-TEST-1' },
      runContext('SESSION-A'),
    )
    expect(first).toEqual({
      subscribed: true,
      subscriptionId: 'SUB-1',
      targetType: 'refund',
      targetId: 'REFUND-TEST-1',
    })
    expect(second).toEqual(first)
    expect(events.list('SESSION-A')).toHaveLength(1)
  })

  it('rejects an unknown refund and a missing Harness session', async () => {
    const { tools } = await createFixture()
    const tool = tools.get('subscribe_refund_progress_alert')
    await expect(tool.execute(
      { refundId: 'REFUND-MISSING' },
      runContext('SESSION-A'),
    )).resolves.toEqual({
      subscribed: false,
      code: 'REFUND_NOT_FOUND',
      message: '未找到退款 REFUND-MISSING。',
    })
    await expect(tool.execute(
      { refundId: 'REFUND-TEST-1' },
      {},
    )).resolves.toEqual({
      subscribed: false,
      code: 'ALERT_SESSION_REQUIRED',
      message: '当前会话无法订阅退款提醒，请在 Harness 会话中重试。',
    })
  })

  it('notifies only the subscribed session when the refund status changes', async () => {
    const { events, messages, state, tools } = await createFixture()
    const tool = tools.get('subscribe_refund_progress_alert')
    await tool.execute({ refundId: 'REFUND-TEST-1' }, runContext('SESSION-A'))

    const change = await state.updateRefund(
      'REFUND-TEST-1',
      () => ({ status: 'processing' }),
    )
    await events.publish(change.event)

    expect(messages).toHaveLength(1)
    expect(messages[0].sessionId).toBe('SESSION-A')
    expect(messages[0].message.content[0].text).toBe(
      '退款 REFUND-TEST-1 状态已更新为：处理中。',
    )
  })

  it('ignores creation events and updates that do not change status', async () => {
    const { events, messages, state, tools } = await createFixture()
    await tools.get('subscribe_refund_progress_alert').execute(
      { refundId: 'REFUND-TEST-1' },
      runContext('SESSION-A'),
    )

    const noOp = await state.updateRefund(
      'REFUND-TEST-1',
      () => ({ status: 'pending' }),
    )
    await events.publish(noOp.event)
    await events.publish({
      eventId: 'EVENT-CREATE',
      type: 'refund.updated',
      entityId: 'REFUND-TEST-1',
      version: 1,
      occurredAt: state.clock.now().toISOString(),
      payload: { before: null, after: state.getRefund('REFUND-TEST-1') },
    })

    expect(messages).toEqual([])
  })
})
