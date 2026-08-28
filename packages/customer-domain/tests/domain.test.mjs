import { describe, expect, it } from 'vitest'

import {
  InvalidBusinessIdError,
  MutableClock,
  createSeedState,
  defineCustomerTool,
  normalizeBusinessId,
} from '../src/index.ts'

describe('customer domain', () => {
  it('normalizes business identifiers and rejects empty identifiers', () => {
    expect(normalizeBusinessId(' order-1001 ')).toBe('ORDER-1001')
    expect(() => normalizeBusinessId('   ')).toThrow(InvalidBusinessIdError)
    expect(() => normalizeBusinessId('   ')).toThrow('业务编号不能为空。')
  })

  it('advances a deterministic clock without exposing its mutable date', () => {
    const clock = new MutableClock('2026-08-27T12:00:00+08:00')
    const exposed = clock.now()
    exposed.setUTCFullYear(2030)
    clock.advanceHours(2)
    expect(clock.now().toISOString()).toBe('2026-08-27T06:00:00.000Z')
    expect(() => clock.advanceHours(0)).toThrow('前进小时数必须大于 0。')
  })

  it('returns independent seed graphs with the accepted baseline values', () => {
    const first = createSeedState()
    const second = createSeedState()

    expect(first.orders.get('ORDER-1001')).toMatchObject({
      orderId: 'ORDER-1001',
      status: 'shipped',
      estimatedDelivery: '2026-08-28',
      version: 1,
    })
    expect(first.orders.get('ORDER-1002')).toMatchObject({
      orderId: 'ORDER-1002',
      status: 'processing',
      estimatedDelivery: '2026-08-30',
      version: 1,
    })
    expect(first.orders.get('ORDER-1003')).toMatchObject({
      orderId: 'ORDER-1003',
      status: 'delivered',
      deliveredAt: '2026-08-26T10:00:00+08:00',
      version: 1,
    })
    expect(first.logistics.get('ORDER-1001')).toMatchObject({
      status: 'in_transit',
      currentStatus: '运输中',
      version: 1,
    })
    expect(first.logistics.get('ORDER-1001').events).toEqual([
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
    ])
    expect(first.inventories.get('SKU-1001')).toMatchObject({
      productName: '无线鼠标',
      stock: 12,
      version: 1,
    })
    expect(first.inventories.get('SKU-1002')).toMatchObject({
      productName: '机械键盘',
      stock: 0,
      version: 1,
    })
    expect(first.returns.size).toBe(0)
    expect(first.refunds.size).toBe(0)

    first.orders.get('ORDER-1002').address = '已修改地址'
    first.logistics.get('ORDER-1001').events[0].description = '已篡改'
    expect(second.orders.get('ORDER-1002').address).not.toBe('已修改地址')
    expect(second.logistics.get('ORDER-1001').events[0].description).toBe('包裹已发出')
  })

  it('defines a runtime-neutral tool with compiled JSON schemas', async () => {
    const tool = defineCustomerTool({
      name: 'echo_customer_id',
      description: 'Echo one customer id.',
      parameters: {
        customerId: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return args.customerId
      },
    })
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: { customerId: { type: 'string' } },
      required: ['customerId'],
    })
    expect(await tool.execute({ customerId: 'CUSTOMER-1' }, {})).toBe('CUSTOMER-1')
    await expect(tool.execute({}, {})).rejects.toThrow('customerId')

    const strictTool = defineCustomerTool({
      name: 'strict_echo_customer_id',
      description: 'Strictly echo one customer id.',
      strictParameters: true,
      parameters: {
        customerId: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return args.customerId
      },
    })
    expect(strictTool.parameters.additionalProperties).toBe(false)
    await expect(strictTool.execute({ customerId: 'CUSTOMER-1', extra: true }, {}))
      .rejects.toThrow('extra 是未知字段')
  })
})
