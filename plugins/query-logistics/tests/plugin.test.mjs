import { describe, expect, it } from 'vitest'

import { apply, inject, name } from '../src/index.ts'

function loadTool(state) {
  const tools = new Map()
  apply({
    customerState: state,
    tools: { register(tool) { tools.set(tool.name, tool) } },
  })
  return tools.get('query_logistics')
}

describe('query_logistics plugin', () => {
  it('registers one query with a strict nested event schema', () => {
    const tool = loadTool({ getLogistics() {} })
    expect(name).toBe('customer-query-logistics')
    expect(inject).toEqual(['tools', 'customerState'])
    const [found, notFound] = tool.output.schema.oneOf
    expect(found.additionalProperties).toBe(false)
    expect(found.properties.events.items).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['time', 'location', 'description'],
    })
    expect(notFound.properties.found).toEqual({ type: 'boolean', const: false })
  })

  it('returns and renders a multiline logistics snapshot', async () => {
    const tool = loadTool({
      getLogistics: () => ({
        orderId: 'ORDER-1001',
        currentStatus: '运输中',
        events: [
          { time: '2026-08-26 09:20', location: '上海分拨中心', description: '包裹已发出' },
          { time: '2026-08-26 18:40', location: '苏州转运中心', description: '包裹运输中' },
        ],
      }),
    })
    const result = await tool.execute({ orderId: 'order-1001' })
    expect(result).toEqual({
      found: true,
      orderId: 'ORDER-1001',
      currentStatus: '运输中',
      events: [
        { time: '2026-08-26 09:20', location: '上海分拨中心', description: '包裹已发出' },
        { time: '2026-08-26 18:40', location: '苏州转运中心', description: '包裹运输中' },
      ],
    })
    expect(tool.output.render({}, result)[0].text).toBe([
      '订单 ORDER-1001 当前物流状态：运输中。',
      '2026-08-26 09:20｜上海分拨中心｜包裹已发出',
      '2026-08-26 18:40｜苏州转运中心｜包裹运输中',
    ].join('\n'))
  })

  it('supports the delivered snapshot without changing the public shape', async () => {
    const tool = loadTool({
      getLogistics: () => ({
        orderId: 'ORDER-1003',
        currentStatus: '已签收',
        events: [{ time: '2026-08-26 10:00', location: '杭州西湖营业点', description: '包裹已签收' }],
      }),
    })
    expect(await tool.execute({ orderId: 'ORDER-1003' })).toEqual({
      found: true,
      orderId: 'ORDER-1003',
      currentStatus: '已签收',
      events: [{ time: '2026-08-26 10:00', location: '杭州西湖营业点', description: '包裹已签收' }],
    })
  })

  it('returns unknown normally and preserves blank input errors', async () => {
    const tool = loadTool({ getLogistics: () => undefined })
    expect(await tool.execute({ orderId: ' unknown-001 ' })).toEqual({
      found: false,
      orderId: 'UNKNOWN-001',
      message: '未找到该订单，请检查订单号。',
    })
    await expect(tool.execute({ orderId: '   ' })).rejects.toThrow('订单号不能为空。')
  })

  it('wraps unexpected state failures and preserves their cause', async () => {
    const tool = loadTool({ getLogistics: () => { throw new Error('database failed') } })
    await expect(tool.execute({ orderId: 'ORDER-1001' })).rejects.toMatchObject({
      message: '物流查询服务暂时不可用，请稍后重试。',
      cause: new Error('database failed'),
    })
  })
})
