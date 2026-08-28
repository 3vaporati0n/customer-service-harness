import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { MutableClock } from '@dsh-customer-service/domain'
import { CustomerEventsService } from '@dsh-customer-service/events'
import { CustomerStateService } from '@dsh-customer-service/state'
import { apply, decideMockApproval, inject } from '../src/index.ts'

function createFixture() {
  const ctx = new Context()
  const messages = []
  let eventId = 0
  let subscriptionId = 0
  const state = new CustomerStateService(ctx, {
    clock: new MutableClock('2026-08-27T12:00:00+08:00'),
    idFactory: () => `EVENT-${++eventId}`,
  })
  const events = new CustomerEventsService(ctx, {
    clock: state.clock,
    idFactory: () => `SUB-${++subscriptionId}`,
    resolveAgent: () => ({ followup(message) { messages.push(message) } }),
  })
  const tools = new Map()
  apply({
    customerState: state,
    customerEvents: events,
    tools: { register(tool) { tools.set(tool.name, tool) } },
    on() {},
  })
  return { events, messages, state, tools }
}

describe('mock operations plugin', () => {
  it('registers four state mutation tools with exact dependencies', () => {
    const { tools } = createFixture()
    expect(inject).toEqual(['tools', 'customerState', 'customerEvents'])
    expect([...tools.keys()]).toEqual([
      'mock_set_inventory',
      'mock_append_logistics_event',
      'mock_set_refund_status',
      'mock_advance_clock',
    ])
  })

  it('sets inventory, publishes the committed event, and triggers a matcher', async () => {
    const { events, messages, state, tools } = createFixture()
    const subscription = events.subscribe({
      sessionId: 'SESSION-A',
      alertType: 'product_restock',
      targetId: 'SKU-1002',
    })
    events.registerMatcher('product_restock', (event) =>
      event.type === 'inventory.changed'
        ? [{
            subscriptionId: subscription.subscriptionId,
            message: '商品 SKU-1002 已补货。',
            fingerprint: `inventory:${event.version}`,
          }]
        : [],
    )
    expect(await tools.get('mock_set_inventory').execute({ sku: 'sku-1002', stock: 5 }))
      .toEqual({ sku: 'SKU-1002', beforeStock: 0, afterStock: 5, version: 2 })
    expect(state.getInventory('SKU-1002')).toMatchObject({ stock: 5, version: 2 })
    expect(messages[0].content[0].text).toBe('商品 SKU-1002 已补货。')
  })

  it('appends logistics events and advances the deterministic clock', async () => {
    const { state, tools } = createFixture()
    expect(await tools.get('mock_append_logistics_event').execute({
      orderId: 'order-1002',
      status: 'in_transit',
      time: '2026-08-27 13:00',
      location: '上海分拨中心',
      description: '包裹已发出',
    })).toEqual({
      orderId: 'ORDER-1002',
      status: 'in_transit',
      currentStatus: '运输中',
      eventCount: 2,
      version: 2,
    })
    expect(await tools.get('mock_advance_clock').execute({ hours: 25 })).toEqual({
      before: '2026-08-27T04:00:00.000Z',
      after: '2026-08-28T05:00:00.000Z',
      version: 1,
    })
    expect(state.getLogistics('ORDER-1002').events).toHaveLength(2)
  })

  it('updates refund status, publishes the committed event, and triggers a matcher', async () => {
    const { events, messages, state, tools } = createFixture()
    await state.createRefund({
      refundId: 'REFUND-TEST-1', orderId: 'ORDER-1003', amount: 258,
      reason: '商品不合适', status: 'pending',
    })
    const subscription = events.subscribe({
      sessionId: 'SESSION-A',
      alertType: 'refund_progress',
      targetId: 'REFUND-TEST-1',
    })
    events.registerMatcher('refund_progress', (event) =>
      event.type === 'refund.updated'
        ? [{
            subscriptionId: subscription.subscriptionId,
            message: '退款 REFUND-TEST-1 状态已更新为：处理中。',
            fingerprint: `refund:${event.version}`,
          }]
        : [],
    )

    expect(await tools.get('mock_set_refund_status').execute({
      refundId: 'refund-test-1', status: 'processing',
    })).toEqual({
      refundId: 'REFUND-TEST-1',
      beforeStatus: 'pending',
      afterStatus: 'processing',
      version: 2,
    })
    expect(state.getRefund('REFUND-TEST-1')).toMatchObject({
      status: 'processing', version: 2,
    })
    expect(messages[0].content[0].text).toBe(
      '退款 REFUND-TEST-1 状态已更新为：处理中。',
    )
  })

  it('rejects unknown entities and invalid numeric inputs', async () => {
    const { tools } = createFixture()
    await expect(tools.get('mock_set_inventory').execute({ sku: 'unknown', stock: 1 }))
      .rejects.toThrow('未找到业务实体 UNKNOWN。')
    await expect(tools.get('mock_set_inventory').execute({ sku: 'SKU-1002', stock: -1 }))
      .rejects.toThrow('库存不能小于 0。')
    await expect(tools.get('mock_advance_clock').execute({ hours: 0 }))
      .rejects.toThrow('前进小时数必须大于 0。')
  })

  it('asks approval only for exact mock tool names', async () => {
    expect(await decideMockApproval('mock_set_inventory', async () => ({ kind: 'allow' })))
      .toEqual({ kind: 'ask', reason: '该演示操作将修改本地验收业务数据。' })
    expect(await decideMockApproval('mock_set_refund_status', async () => ({ kind: 'allow' })))
      .toEqual({ kind: 'ask', reason: '该演示操作将修改本地验收业务数据。' })
    expect(await decideMockApproval('query_inventory', async () => ({ kind: 'allow' })))
      .toEqual({ kind: 'allow' })
    expect(await decideMockApproval('mock_set_inventory_extra', async () => ({ kind: 'allow' })))
      .toEqual({ kind: 'allow' })
  })
})
