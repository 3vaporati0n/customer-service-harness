import { describe, expect, it } from 'vitest'

import { apply, inject, name } from '../src/index.ts'

function loadTool(state) {
  const tools = new Map()
  apply({
    customerState: state,
    tools: { register(tool) { tools.set(tool.name, tool) } },
  })
  return tools.get('query_order')
}

const shippedOrder = {
  orderId: 'ORDER-1001',
  status: 'shipped',
  estimatedDelivery: '2026-08-28',
  items: [{ sku: 'SKU-1001', quantity: 1, unitPrice: 199 }],
}

describe('query_order plugin', () => {
  it('registers one strict modular order query', () => {
    const tool = loadTool({ getOrder() {}, getLogistics() {} })
    expect(name).toBe('customer-query-order')
    expect(inject).toEqual(['tools', 'customerState'])
    expect(tool.description).toContain('商品 SKU')
    expect(tool.parameters.required).toEqual(['orderId'])
    const [found, notFound] = tool.output.schema.oneOf
    expect(found.additionalProperties).toBe(false)
    expect(found.properties.status.enum).toEqual([
      'shipped',
      'processing',
      'delivered',
      'cancelled',
    ])
    expect(found.required).toContain('items')
    expect(found.properties.items).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sku', 'quantity', 'unitPrice'],
      },
    })
    expect(notFound.properties.found).toEqual({ type: 'boolean', const: false })
  })

  it('combines order and logistics snapshots and renders Chinese status', async () => {
    const tool = loadTool({
      getOrder: () => shippedOrder,
      getLogistics: () => ({ currentStatus: '运输中' }),
    })
    const result = await tool.execute({ orderId: 'order-1001' })
    expect(result).toEqual({
      found: true,
      orderId: 'ORDER-1001',
      status: 'shipped',
      logisticsStatus: '运输中',
      estimatedDelivery: '2026-08-28',
      items: [{ sku: 'SKU-1001', quantity: 1, unitPrice: 199 }],
    })
    expect(tool.output.render({}, result)[0].text).toBe(
      '订单 ORDER-1001 当前状态：已发货；物流状态：运输中；预计送达时间：2026-08-28。商品：SKU-1001 ×1（单价 199 元）。',
    )
  })

  it('renders delivered and cancelled states', async () => {
    const delivered = loadTool({
      getOrder: () => ({ ...shippedOrder, status: 'delivered' }),
      getLogistics: () => ({ currentStatus: '已签收' }),
    })
    const cancelled = loadTool({
      getOrder: () => ({ ...shippedOrder, status: 'cancelled' }),
      getLogistics: () => ({ currentStatus: '已取消' }),
    })
    expect(delivered.output.render({}, await delivered.execute({ orderId: 'ORDER-1001' }))[0].text)
      .toContain('当前状态：已签收')
    expect(cancelled.output.render({}, await cancelled.execute({ orderId: 'ORDER-1001' }))[0].text)
      .toContain('当前状态：已取消')
  })

  it('returns a normal unknown result and preserves input errors', async () => {
    const tool = loadTool({ getOrder: () => undefined, getLogistics: () => undefined })
    expect(await tool.execute({ orderId: ' unknown-001 ' })).toEqual({
      found: false,
      orderId: 'UNKNOWN-001',
      message: '未找到该订单，请检查订单号。',
    })
    await expect(tool.execute({ orderId: '   ' })).rejects.toThrow('订单号不能为空。')
  })

  it('wraps inconsistent or failed state access as a service error', async () => {
    const inconsistent = loadTool({
      getOrder: () => shippedOrder,
      getLogistics: () => undefined,
    })
    const failed = loadTool({
      getOrder: () => { throw new Error('database failed') },
      getLogistics: () => undefined,
    })
    await expect(inconsistent.execute({ orderId: 'ORDER-1001' }))
      .rejects.toThrow('订单查询服务暂时不可用，请稍后重试。')
    await expect(failed.execute({ orderId: 'ORDER-1001' }))
      .rejects.toMatchObject({
        message: '订单查询服务暂时不可用，请稍后重试。',
        cause: new Error('database failed'),
      })
  })
})
