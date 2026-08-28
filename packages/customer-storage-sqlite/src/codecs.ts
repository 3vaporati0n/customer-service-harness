import {
  CustomerStorageCorruptionError,
  type Inventory,
  type Logistics,
  type Order,
  type Refund,
  type ReturnRequest,
} from '@dsh-customer-service/domain'

function requiredString(row: Record<string, unknown>, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') throw new CustomerStorageCorruptionError(column)
  return value
}

function requiredNumber(row: Record<string, unknown>, column: string): number {
  const value = row[column]
  if (typeof value !== 'number') throw new CustomerStorageCorruptionError(column)
  return value
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value)
}

export function decodeJson<T>(column: string, value: unknown): T {
  if (typeof value !== 'string') throw new CustomerStorageCorruptionError(column)
  try {
    return JSON.parse(value) as T
  } catch {
    throw new CustomerStorageCorruptionError(column)
  }
}

export function decodeOrder(row: Record<string, unknown>): Order {
  const deliveredAt = row.delivered_at
  if (deliveredAt !== null && deliveredAt !== undefined && typeof deliveredAt !== 'string') {
    throw new CustomerStorageCorruptionError('delivered_at')
  }
  return {
    orderId: requiredString(row, 'order_id'),
    customerId: requiredString(row, 'customer_id'),
    status: requiredString(row, 'status') as Order['status'],
    address: requiredString(row, 'address'),
    estimatedDelivery: requiredString(row, 'estimated_delivery'),
    items: decodeJson<Order['items']>('items_json', row.items_json),
    totalAmount: requiredNumber(row, 'total_amount'),
    createdAt: requiredString(row, 'created_at'),
    ...(deliveredAt ? { deliveredAt } : {}),
    updatedAt: requiredString(row, 'updated_at'),
    version: requiredNumber(row, 'version'),
  }
}

export function decodeLogistics(row: Record<string, unknown>): Logistics {
  return {
    orderId: requiredString(row, 'order_id'),
    status: requiredString(row, 'status') as Logistics['status'],
    currentStatus: requiredString(row, 'current_status'),
    events: decodeJson<Logistics['events']>('events_json', row.events_json),
    updatedAt: requiredString(row, 'updated_at'),
    version: requiredNumber(row, 'version'),
  }
}

export function decodeInventory(row: Record<string, unknown>): Inventory {
  return {
    sku: requiredString(row, 'sku'),
    productName: requiredString(row, 'product_name'),
    stock: requiredNumber(row, 'stock'),
    updatedAt: requiredString(row, 'updated_at'),
    version: requiredNumber(row, 'version'),
  }
}

export function decodeReturn(row: Record<string, unknown>): ReturnRequest {
  return {
    returnId: requiredString(row, 'return_id'),
    orderId: requiredString(row, 'order_id'),
    reason: requiredString(row, 'reason'),
    status: requiredString(row, 'status') as ReturnRequest['status'],
    createdAt: requiredString(row, 'created_at'),
    version: requiredNumber(row, 'version'),
  }
}

export function decodeRefund(row: Record<string, unknown>): Refund {
  const returnId = row.return_id
  if (returnId !== null && returnId !== undefined && typeof returnId !== 'string') {
    throw new CustomerStorageCorruptionError('return_id')
  }
  return {
    refundId: requiredString(row, 'refund_id'),
    orderId: requiredString(row, 'order_id'),
    ...(returnId ? { returnId } : {}),
    amount: requiredNumber(row, 'amount'),
    reason: requiredString(row, 'reason'),
    status: requiredString(row, 'status') as Refund['status'],
    updatedAt: requiredString(row, 'updated_at'),
    version: requiredNumber(row, 'version'),
  }
}
