export type OrderStatus = 'shipped' | 'processing'

export const ORDER_NOT_FOUND_MESSAGE = '未找到该订单，请检查订单号。'

export interface OrderRecord {
  readonly orderId: string
  readonly status: OrderStatus
  readonly logisticsStatus: string
  readonly estimatedDelivery: string
}

export type OrderQueryResult =
  | ({ readonly found: true } & OrderRecord)
  | {
      readonly found: false
      readonly orderId: string
      readonly message: typeof ORDER_NOT_FOUND_MESSAGE
    }

export class InvalidOrderIdError extends Error {
  constructor() {
    super('订单号不能为空。')
    this.name = 'InvalidOrderIdError'
  }
}

const ORDERS: Readonly<Partial<Record<string, OrderRecord>>> = {
  'ORDER-1001': {
    orderId: 'ORDER-1001',
    status: 'shipped',
    logisticsStatus: '运输中',
    estimatedDelivery: '2026-08-28',
  },
  'ORDER-1002': {
    orderId: 'ORDER-1002',
    status: 'processing',
    logisticsStatus: '待发货',
    estimatedDelivery: '2026-08-30',
  },
}

export function normalizeOrderId(raw: string): string {
  return raw.trim().toUpperCase()
}

export function findOrder(raw: string): OrderQueryResult {
  const orderId = normalizeOrderId(raw)
  if (!orderId) throw new InvalidOrderIdError()

  const order = ORDERS[orderId]
  if (!order) {
    return {
      found: false,
      orderId,
      message: ORDER_NOT_FOUND_MESSAGE,
    }
  }

  return { found: true, ...order }
}
