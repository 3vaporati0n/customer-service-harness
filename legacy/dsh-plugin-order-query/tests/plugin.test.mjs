import { describe, expect, it } from 'vitest'

import { apply, inject, name } from '../src/index.ts'

function loadPlugin() {
  const tools = new Map()
  const ctx = {
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
  }

  apply(ctx)
  return tools
}

function loadTool(toolName) {
  const tool = loadPlugin().get(toolName)
  if (!tool) throw new Error(`tool not registered: ${toolName}`)
  return tool
}

describe('order-query plugin', () => {
  it('declares the tools dependency and registers query_order', () => {
    const tools = loadPlugin()
    const tool = tools.get('query_order')

    expect([...tools.keys()]).toEqual(['query_order', 'query_logistics'])
    expect(name).toBe('order-query')
    expect(inject).toEqual(['tools'])
    expect(tool.name).toBe('query_order')
    expect(tool.description).toContain('订单')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    })
  })

  it('compiles two strict output branches with boolean discriminants', () => {
    const tool = loadTool('query_order')
    const [found, notFound] = tool.output.schema.oneOf

    expect(found.additionalProperties).toBe(false)
    expect(found.properties.found).toEqual({ type: 'boolean', const: true })
    expect(found.required).toEqual([
      'found',
      'orderId',
      'status',
      'logisticsStatus',
      'estimatedDelivery',
    ])
    expect(notFound.additionalProperties).toBe(false)
    expect(notFound.properties.found).toEqual({ type: 'boolean', const: false })
    expect(notFound.properties.message).toEqual({
      type: 'string',
      const: '未找到该订单，请检查订单号。',
    })
    expect(notFound.required).toEqual(['found', 'orderId', 'message'])
  })

  it('returns and renders a known order', async () => {
    const tool = loadTool('query_order')
    const result = await tool.execute({ orderId: 'order-1001' })

    expect(result).toEqual({
      found: true,
      orderId: 'ORDER-1001',
      status: 'shipped',
      logisticsStatus: '运输中',
      estimatedDelivery: '2026-08-28',
    })
    expect(tool.output.render({}, result)).toEqual([
      {
        type: 'text',
        text: '订单 ORDER-1001 当前状态：已发货；物流状态：运输中；预计送达时间：2026-08-28。',
      },
    ])
  })

  it('renders the processing status in Chinese', async () => {
    const tool = loadTool('query_order')
    const result = await tool.execute({ orderId: 'ORDER-1002' })

    expect(result).toEqual({
      found: true,
      orderId: 'ORDER-1002',
      status: 'processing',
      logisticsStatus: '待发货',
      estimatedDelivery: '2026-08-30',
    })
    expect(tool.output.render({}, result)).toEqual([
      {
        type: 'text',
        text: '订单 ORDER-1002 当前状态：处理中；物流状态：待发货；预计送达时间：2026-08-30。',
      },
    ])
  })

  it('returns and renders a normal not-found result', async () => {
    const tool = loadTool('query_order')
    const result = await tool.execute({ orderId: 'unknown-001' })

    expect(result).toEqual({
      found: false,
      orderId: 'UNKNOWN-001',
      message: '未找到该订单，请检查订单号。',
    })
    expect(tool.output.render({}, result)).toEqual([
      { type: 'text', text: '未找到订单 UNKNOWN-001，请检查订单号。' },
    ])
  })

  it('lets defineTool reject a missing orderId', async () => {
    const tool = loadTool('query_order')

    await expect(tool.execute({})).rejects.toMatchObject({
      name: 'ToolArgsError',
      message: 'invalid arguments: missing required property "orderId"',
    })
  })

  it('preserves the explicit blank-order input error', async () => {
    const tool = loadTool('query_order')

    await expect(tool.execute({ orderId: '   ' })).rejects.toThrow(
      '订单号不能为空。',
    )
  })

  it('compiles a strict nested logistics output schema', () => {
    const tool = loadTool('query_logistics')
    const [found, notFound] = tool.output.schema.oneOf
    const event = found.properties.events.items

    expect(tool.parameters.required).toEqual(['orderId'])
    expect(found.properties.found).toEqual({ type: 'boolean', const: true })
    expect(found.additionalProperties).toBe(false)
    expect(event).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['time', 'location', 'description'],
    })
    expect(notFound.properties.found).toEqual({
      type: 'boolean',
      const: false,
    })
    expect(notFound.additionalProperties).toBe(false)
  })

  it('returns and renders tracking events for ORDER-1001', async () => {
    const tool = loadTool('query_logistics')
    const result = await tool.execute({ orderId: 'order-1001' })

    expect(result).toEqual({
      found: true,
      orderId: 'ORDER-1001',
      currentStatus: '运输中',
      events: [
        {
          time: '2026-08-26 09:20',
          location: '上海分拨中心',
          description: '包裹已发出',
        },
        {
          time: '2026-08-26 18:40',
          location: '苏州转运中心',
          description: '包裹运输中',
        },
      ],
    })
    expect(tool.output.render({}, result)).toEqual([
      {
        type: 'text',
        text: [
          '订单 ORDER-1001 当前物流状态：运输中。',
          '2026-08-26 09:20｜上海分拨中心｜包裹已发出',
          '2026-08-26 18:40｜苏州转运中心｜包裹运输中',
        ].join('\n'),
      },
    ])
  })

  it('returns and renders the pending shipment event', async () => {
    const tool = loadTool('query_logistics')
    const result = await tool.execute({ orderId: 'ORDER-1002' })

    expect(result.currentStatus).toBe('待发货')
    expect(result.events).toEqual([
      {
        time: '2026-08-27 08:00',
        location: '商家仓库',
        description: '订单已创建，等待发货',
      },
    ])
    expect(tool.output.render({}, result)[0].text).toBe(
      '订单 ORDER-1002 当前物流状态：待发货。\n' +
        '2026-08-27 08:00｜商家仓库｜订单已创建，等待发货',
    )
  })

  it('returns and renders a normal logistics not-found result', async () => {
    const tool = loadTool('query_logistics')
    const result = await tool.execute({ orderId: 'unknown-001' })

    expect(result).toEqual({
      found: false,
      orderId: 'UNKNOWN-001',
      message: '未找到该订单，请检查订单号。',
    })
    expect(tool.output.render({}, result)).toEqual([
      { type: 'text', text: '未找到订单 UNKNOWN-001，请检查订单号。' },
    ])
  })

  it('validates logistics arguments and preserves blank input errors', async () => {
    const tool = loadTool('query_logistics')

    await expect(tool.execute({})).rejects.toMatchObject({
      name: 'ToolArgsError',
      message: 'invalid arguments: missing required property "orderId"',
    })
    await expect(tool.execute({ orderId: '   ' })).rejects.toThrow(
      '订单号不能为空。',
    )
  })
})
