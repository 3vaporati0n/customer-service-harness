import {
  InvalidOrderIdError,
  normalizeOrderId,
  ORDER_NOT_FOUND_MESSAGE,
} from './orders.js'

export interface LogisticsEvent {
  readonly time: string
  readonly location: string
  readonly description: string
}

export type LogisticsQueryResult =
  | {
      readonly found: true
      readonly orderId: string
      readonly currentStatus: string
      readonly events: LogisticsEvent[]
    }
  | {
      readonly found: false
      readonly orderId: string
      readonly message: typeof ORDER_NOT_FOUND_MESSAGE
    }

interface LogisticsRecord {
  readonly currentStatus: string
  readonly events: LogisticsEvent[]
}

const LOGISTICS: Readonly<Partial<Record<string, LogisticsRecord>>> = {
  'ORDER-1001': {
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
  },
  'ORDER-1002': {
    currentStatus: '待发货',
    events: [
      {
        time: '2026-08-27 08:00',
        location: '商家仓库',
        description: '订单已创建，等待发货',
      },
    ],
  },
}

export function findLogistics(raw: string): LogisticsQueryResult {
  const orderId = normalizeOrderId(raw)
  if (!orderId) throw new InvalidOrderIdError()

  const record = LOGISTICS[orderId]
  if (!record) {
    return {
      found: false,
      orderId,
      message: ORDER_NOT_FOUND_MESSAGE,
    }
  }

  return { found: true, orderId, ...record }
}
