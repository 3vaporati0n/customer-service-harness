import { describe, expect, it } from 'vitest'

import { findLogistics } from '../src/logistics.ts'
import { InvalidOrderIdError } from '../src/orders.ts'

describe('logistics lookup domain', () => {
  it('returns ordered tracking events for ORDER-1001', () => {
    expect(findLogistics('ORDER-1001')).toEqual({
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
  })

  it('returns the pending shipment event for ORDER-1002', () => {
    expect(findLogistics('ORDER-1002')).toEqual({
      found: true,
      orderId: 'ORDER-1002',
      currentStatus: '待发货',
      events: [
        {
          time: '2026-08-27 08:00',
          location: '商家仓库',
          description: '订单已创建，等待发货',
        },
      ],
    })
  })

  it('normalizes whitespace and letter case', () => {
    expect(findLogistics(' order-1001 ')).toEqual(findLogistics('ORDER-1001'))
  })

  it('returns a normal not-found result', () => {
    expect(findLogistics('unknown-001')).toEqual({
      found: false,
      orderId: 'UNKNOWN-001',
      message: '未找到该订单，请检查订单号。',
    })
  })

  it('preserves the shared blank-order input error', () => {
    expect(() => findLogistics('   ')).toThrow(InvalidOrderIdError)
    expect(() => findLogistics('   ')).toThrow('订单号不能为空。')
  })
})
