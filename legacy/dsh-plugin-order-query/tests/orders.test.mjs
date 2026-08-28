import { describe, expect, it } from 'vitest'

import {
  findOrder,
  InvalidOrderIdError,
  normalizeOrderId,
} from '../src/orders.ts'

describe('order lookup domain', () => {
  it('returns the known shipped order', () => {
    expect(findOrder('ORDER-1001')).toEqual({
      found: true,
      orderId: 'ORDER-1001',
      status: 'shipped',
      logisticsStatus: '运输中',
      estimatedDelivery: '2026-08-28',
    })
  })

  it('returns the known processing order', () => {
    expect(findOrder('ORDER-1002')).toEqual({
      found: true,
      orderId: 'ORDER-1002',
      status: 'processing',
      logisticsStatus: '待发货',
      estimatedDelivery: '2026-08-30',
    })
  })

  it('normalizes surrounding whitespace and letter case', () => {
    expect(normalizeOrderId(' order-1001 ')).toBe('ORDER-1001')
    expect(findOrder(' order-1001 ')).toEqual(findOrder('ORDER-1001'))
  })

  it('returns a normal not-found result for an unknown order', () => {
    expect(findOrder('unknown-001')).toEqual({
      found: false,
      orderId: 'UNKNOWN-001',
      message: '未找到该订单，请检查订单号。',
    })
  })

  it('rejects an order id that is empty after normalization', () => {
    expect(() => findOrder('   ')).toThrow(InvalidOrderIdError)
    expect(() => findOrder('   ')).toThrow('订单号不能为空。')
  })
})
