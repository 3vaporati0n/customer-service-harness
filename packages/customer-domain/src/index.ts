export type OrderStatus = 'processing' | 'shipped' | 'delivered' | 'cancelled'

export type LogisticsStatus =
  | 'pending_shipment'
  | 'in_transit'
  | 'delivered'
  | 'delivery_failed'

export const LOGISTICS_STATUS_LABELS: Readonly<Record<LogisticsStatus, string>> = {
  pending_shipment: '待发货',
  in_transit: '运输中',
  delivered: '已签收',
  delivery_failed: '配送失败',
}

export type ReturnStatus = 'approved' | 'received' | 'rejected'
export type RefundStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

export type CustomerAction =
  | 'cancel_order'
  | 'return_order'
  | 'refund_order'
  | 'change_address'

export type AlertType =
  | 'logistics_anomaly'
  | 'product_restock'
  | 'delivery'
  | 'refund_progress'

export interface Clock {
  now(): Date
}

export class MutableClock implements Clock {
  #current: Date

  constructor(initial: string) {
    this.#current = new Date(initial)
    if (Number.isNaN(this.#current.valueOf())) {
      throw new Error('无效的初始时间。')
    }
  }

  now(): Date {
    return new Date(this.#current)
  }

  advanceHours(hours: number): void {
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error('前进小时数必须大于 0。')
    }
    this.#current = new Date(this.#current.valueOf() + hours * 3_600_000)
  }
}

export class InvalidBusinessIdError extends Error {
  constructor() {
    super('业务编号不能为空。')
    this.name = 'InvalidBusinessIdError'
  }
}

export class EntityNotFoundError extends Error {
  constructor(id: string) {
    super(`未找到业务实体 ${id}。`)
    this.name = 'EntityNotFoundError'
  }
}

export class EntityAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`业务实体 ${id} 已存在。`)
    this.name = 'EntityAlreadyExistsError'
  }
}

export function normalizeBusinessId(raw: string): string {
  const value = raw.trim().toUpperCase()
  if (!value) throw new InvalidBusinessIdError()
  return value
}

export interface OrderItem {
  sku: string
  quantity: number
  unitPrice: number
}

export interface Order {
  orderId: string
  customerId: string
  status: OrderStatus
  address: string
  estimatedDelivery: string
  items: OrderItem[]
  totalAmount: number
  createdAt: string
  deliveredAt?: string
  updatedAt: string
  version: number
}

export interface Inventory {
  sku: string
  productName: string
  stock: number
  updatedAt: string
  version: number
}

export interface LogisticsEvent {
  time: string
  location: string
  description: string
}

export interface Logistics {
  orderId: string
  status: LogisticsStatus
  currentStatus: string
  events: LogisticsEvent[]
  updatedAt: string
  version: number
}

export interface ReturnRequest {
  returnId: string
  orderId: string
  reason: string
  status: ReturnStatus
  createdAt: string
  version: number
}

export interface Refund {
  refundId: string
  orderId: string
  returnId?: string
  amount: number
  reason: string
  status: RefundStatus
  updatedAt: string
  version: number
}

export interface ActionConfirmation {
  confirmationId: string
  action: CustomerAction
  targetId: string
  payload: Readonly<Record<string, unknown>>
  createdAt: string
  expiresAt: string
  consumedAt?: string
  auditId?: string
}

export interface AuditRecord {
  auditId: string
  action: CustomerAction
  targetId: string
  before: Readonly<Record<string, unknown>>
  after: Readonly<Record<string, unknown>>
  occurredAt: string
}

export interface CustomerDomainEvent {
  eventId: string
  type:
    | 'order.updated'
    | 'inventory.changed'
    | 'logistics.updated'
    | 'return.updated'
    | 'refund.updated'
    | 'clock.advanced'
  entityId: string
  version: number
  occurredAt: string
  payload: Readonly<Record<string, unknown>>
}

export interface AlertSubscription {
  subscriptionId: string
  sessionId: string
  alertType: AlertType
  targetId: string
  active: boolean
  createdAt: string
  lastTriggeredVersion?: number
  lastTriggeredFingerprint?: string
}

export interface SeedState {
  orders: Map<string, Order>
  inventories: Map<string, Inventory>
  logistics: Map<string, Logistics>
  returns: Map<string, ReturnRequest>
  refunds: Map<string, Refund>
}

export interface CustomerStorage {
  transaction<T>(operation: () => T): T
  getOrder(id: string): Order | undefined
  getLogistics(id: string): Logistics | undefined
  getInventory(id: string): Inventory | undefined
  getReturn(id: string): ReturnRequest | undefined
  getRefund(id: string): Refund | undefined
  listReturnsByOrder(orderId: string): ReturnRequest[]
  listRefundsByOrder(orderId: string): Refund[]
  findReturnByOrder(orderId: string): ReturnRequest | undefined
  findRefundByOrder(orderId: string): Refund | undefined
  insertOrder(record: Order): void
  insertInventory(record: Inventory): void
  insertLogistics(record: Logistics): void
  insertReturn(record: ReturnRequest): void
  insertRefund(record: Refund): void
  replaceOrder(record: Order, expectedVersion: number): void
  replaceLogistics(record: Logistics, expectedVersion: number): void
  replaceInventory(record: Inventory, expectedVersion: number): void
  replaceReturn(record: ReturnRequest, expectedVersion: number): void
  replaceRefund(record: Refund, expectedVersion: number): void
  close(): void
}

export class StorageVersionConflictError extends Error {
  constructor(id: string, expectedVersion: number) {
    super(`业务实体 ${id} 的存储版本不是 ${expectedVersion}。`)
    this.name = 'StorageVersionConflictError'
  }
}

export class CustomerStorageCorruptionError extends Error {
  constructor(column: string) {
    super(`客服数据库字段 ${column} 的内容已损坏。`)
    this.name = 'CustomerStorageCorruptionError'
  }
}

export { createSeedState } from './seeds.js'
export { defineCustomerTool } from './tool-definition.js'
