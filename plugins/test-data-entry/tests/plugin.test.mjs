import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { MutableClock } from '@dsh-customer-service/domain'
import { CustomerEventsService } from '@dsh-customer-service/events'
import { CustomerStateService } from '@dsh-customer-service/state'
import {
  apply,
  decideTestDataApproval,
  inject,
} from '../src/index.ts'

function createFixture() {
  const ctx = new Context()
  let eventId = 0
  let subscriptionId = 0
  const state = new CustomerStateService(ctx, {
    clock: new MutableClock('2026-08-28T10:00:00+08:00'),
    idFactory: () => `EVENT-${++eventId}`,
  })
  const published = []
  const events = new CustomerEventsService(ctx, {
    clock: state.clock,
    idFactory: () => `SUB-${++subscriptionId}`,
    resolveAgent: () => undefined,
  })
  events.subscribe({
    sessionId: 'SESSION-A', alertType: 'product_restock', targetId: 'SKU-TEST-001',
  })
  events.registerMatcher('product_restock', (event) => {
    published.push(event)
    return []
  })
  const tools = new Map()
  apply({
    customerState: state,
    customerEvents: events,
    tools: { register(tool) { tools.set(tool.name, tool) } },
    on() {},
  })
  return { published, state, tools }
}

describe('customer test data entry plugin', () => {
  it('registers exactly five tools with exact dependencies', () => {
    const { tools } = createFixture()
    expect(inject).toEqual(['tools', 'customerState', 'customerEvents'])
    expect([...tools.keys()]).toEqual([
      'test_create_inventory',
      'test_create_order',
      'test_create_logistics',
      'test_create_return',
      'test_create_refund',
    ])
  })

  it('creates all five records, renders Chinese results, and publishes events', async () => {
    const { published, tools } = createFixture()
    const cases = [
      ['test_create_inventory', {
        sku: 'sku-test-001', productName: '测试鼠标', stock: 20,
      }, {
        sku: 'SKU-TEST-001', productName: '测试鼠标', stock: 20, version: 1,
      }, '测试商品 SKU-TEST-001（测试鼠标）已创建，库存 20 件。'],
      ['test_create_order', {
        orderId: 'order-test-001', customerId: 'customer-test-001',
        address: '苏州市工业园区', estimatedDelivery: '2026-09-01',
        items: [{ sku: 'sku-test-001', quantity: 2, unitPrice: 99 }],
      }, {
        orderId: 'ORDER-TEST-001', status: 'processing',
        itemCount: 2, totalAmount: 198, version: 1,
      }, '测试订单 ORDER-TEST-001 已创建，共 2 件商品，金额 198 元。'],
      ['test_create_logistics', {
        orderId: 'order-test-001', location: '苏州仓库', description: '测试物流已创建',
      }, {
        orderId: 'ORDER-TEST-001', status: 'pending_shipment',
        currentStatus: '待发货', eventCount: 1, version: 1,
      }, '订单 ORDER-TEST-001 的测试物流已创建，当前状态：待发货。'],
      ['test_create_return', {
        returnId: 'return-test-001', orderId: 'order-test-001',
        reason: '不合适', status: 'approved',
      }, {
        returnId: 'RETURN-TEST-001', orderId: 'ORDER-TEST-001',
        status: 'approved', version: 1,
      }, '订单 ORDER-TEST-001 的退货记录 RETURN-TEST-001 已创建，状态：已批准。'],
      ['test_create_refund', {
        refundId: 'refund-test-001', orderId: 'order-test-001',
        returnId: 'return-test-001', amount: 198, reason: '退货退款',
      }, {
        refundId: 'REFUND-TEST-001', orderId: 'ORDER-TEST-001',
        amount: 198, status: 'pending', version: 1,
      }, '订单 ORDER-TEST-001 的退款记录 REFUND-TEST-001 已创建，金额 198 元，状态：待处理。'],
    ]

    for (const [name, args, expected, rendered] of cases) {
      const tool = tools.get(name)
      const result = await tool.execute(args)
      expect(result).toEqual(expected)
      expect(tool.output.render(args, result)).toEqual([{ type: 'text', text: rendered }])
    }
    expect(published.map((event) => event.type)).toEqual([
      'inventory.changed', 'order.updated', 'logistics.updated',
      'return.updated', 'refund.updated',
    ])
  })

  it('does not publish an event when strict creation fails', async () => {
    const { published, tools } = createFixture()
    await expect(tools.get('test_create_order').execute({
      orderId: 'ORDER-X', customerId: 'CUSTOMER-X', address: '苏州',
      estimatedDelivery: '2026-09-01',
      items: [{ sku: 'SKU-MISSING', quantity: 1, unitPrice: 1 }],
    })).rejects.toThrow('商品 SKU-MISSING 不存在，无法加入订单。')
    expect(published).toEqual([])
  })

  it('keeps test-data entry limited to one return and one refund per order', async () => {
    const { tools } = createFixture()
    const returns = tools.get('test_create_return')
    const refunds = tools.get('test_create_refund')
    await returns.execute({
      returnId: 'RETURN-A', orderId: 'ORDER-1003', reason: '第一次', status: 'rejected',
    })
    await expect(returns.execute({
      returnId: 'RETURN-B', orderId: 'ORDER-1003', reason: '第二次', status: 'approved',
    })).rejects.toThrow('业务实体 RETURN-A 已存在。')
    await refunds.execute({
      refundId: 'REFUND-A', orderId: 'ORDER-1003', amount: 258,
      reason: '第一次', status: 'failed',
    })
    await expect(refunds.execute({
      refundId: 'REFUND-B', orderId: 'ORDER-1003', amount: 258,
      reason: '第二次', status: 'pending',
    })).rejects.toThrow('业务实体 REFUND-A 已存在。')
  })

  it('uses strict schemas for nested order items', () => {
    const { tools } = createFixture()
    const parameters = tools.get('test_create_order').parameters
    expect(parameters.additionalProperties).toBe(false)
    expect(parameters.properties.items.items).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['sku', 'quantity', 'unitPrice'],
    })
    expect(tools.get('test_create_order').output.schema.additionalProperties).toBe(false)
  })

  it('asks approval only for exact test data tool names', async () => {
    for (const name of [
      'test_create_inventory', 'test_create_order', 'test_create_logistics',
      'test_create_return', 'test_create_refund',
    ]) {
      await expect(decideTestDataApproval(name, async () => ({ kind: 'allow' })))
        .resolves.toEqual({
          kind: 'ask',
          reason: '该操作将向本地 SQLite 验收数据库新增客服测试数据。',
        })
    }
    await expect(decideTestDataApproval('query_order', async () => ({ kind: 'allow' })))
      .resolves.toEqual({ kind: 'allow' })
    await expect(decideTestDataApproval('test_create_order_extra', async () => ({ kind: 'allow' })))
      .resolves.toEqual({ kind: 'allow' })
  })
})
