import type { Context } from '@deepseek-ai/cordis'
import {
  EntityAlreadyExistsError,
  EntityNotFoundError,
  LOGISTICS_STATUS_LABELS,
  MutableClock,
  createSeedState,
  normalizeBusinessId,
  type Clock,
  type CustomerDomainEvent,
  type CustomerStorage,
  type Inventory,
  type Logistics,
  type LogisticsStatus,
  type Order,
  type Refund,
  type ReturnRequest,
} from '@dsh-customer-service/domain'
import { MemoryCustomerStorage } from './memory-storage.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customerStorage: CustomerStorage
    customerState: CustomerStateService
  }
}

export interface StateChange<T> {
  readonly before: T | null
  readonly after: T
  readonly event: CustomerDomainEvent
}

export interface CustomerStateOptions {
  clock?: Clock
  idFactory?: () => string
  storage?: CustomerStorage
}

export type CreateInventoryInput = Pick<Inventory, 'sku' | 'productName' | 'stock'>
export type CreateOrderInput = Omit<
  Order,
  'totalAmount' | 'createdAt' | 'deliveredAt' | 'updatedAt' | 'version'
>
export interface CreateLogisticsInput {
  orderId: string
  status: LogisticsStatus
  location: string
  description: string
}
export type CreateReturnInput = Omit<ReturnRequest, 'createdAt' | 'version'>
export type CreateRefundInput = Omit<Refund, 'updatedAt' | 'version'>

type Versioned = { version: number }
type EntityEventType = Exclude<CustomerDomainEvent['type'], 'clock.advanced'>

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

function detached<T>(value: T): T {
  return structuredClone(value)
}

function nonBlank(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空。`)
  return normalized
}

function assertNonNegativeFinite(value: number, message: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(message)
}

function assertDateOnly(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('预计送达日期必须是有效的 YYYY-MM-DD 日期。')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('预计送达日期必须是有效的 YYYY-MM-DD 日期。')
  }
}

export class CustomerStateService {
  readonly #storage: CustomerStorage
  readonly #queues = new Map<string, Promise<void>>()
  readonly #clock: Clock
  readonly #idFactory: () => string
  #clockVersion = 0

  constructor(ctx: Context, options: CustomerStateOptions = {}) {
    void ctx
    this.#storage = options.storage ?? new MemoryCustomerStorage(createSeedState())
    this.#clock = options.clock ?? new MutableClock('2026-08-27T12:00:00+08:00')
    this.#idFactory = options.idFactory ?? (() => `EVENT-${crypto.randomUUID()}`)
  }

  get clock(): Clock {
    return this.#clock
  }

  getOrder(raw: string): Order | undefined {
    return this.#storage.getOrder(normalizeBusinessId(raw))
  }

  getLogistics(raw: string): Logistics | undefined {
    return this.#storage.getLogistics(normalizeBusinessId(raw))
  }

  getInventory(raw: string): Inventory | undefined {
    return this.#storage.getInventory(normalizeBusinessId(raw))
  }

  getReturn(raw: string): ReturnRequest | undefined {
    return this.#storage.getReturn(normalizeBusinessId(raw))
  }

  getRefund(raw: string): Refund | undefined {
    return this.#storage.getRefund(normalizeBusinessId(raw))
  }

  listReturnsByOrder(rawOrderId: string): ReturnRequest[] {
    return this.#storage.listReturnsByOrder(normalizeBusinessId(rawOrderId))
  }

  listRefundsByOrder(rawOrderId: string): Refund[] {
    return this.#storage.listRefundsByOrder(normalizeBusinessId(rawOrderId))
  }

  findReturnByOrder(rawOrderId: string): ReturnRequest | undefined {
    return this.#storage.findReturnByOrder(normalizeBusinessId(rawOrderId))
  }

  findRefundByOrder(rawOrderId: string): Refund | undefined {
    return this.#storage.findRefundByOrder(normalizeBusinessId(rawOrderId))
  }

  updateOrder(
    raw: string,
    patch: (current: Readonly<Order>) => Partial<Order>,
  ): Promise<StateChange<Order>> {
    return this.#update(
      raw,
      'orderId',
      (id) => this.#storage.getOrder(id),
      (record, expected) => this.#storage.replaceOrder(record, expected),
      patch,
      'order.updated',
      true,
      undefined,
      'order',
    )
  }

  updateOrderIf(
    raw: string,
    predicate: (current: Readonly<Order>) => boolean,
    patch: (current: Readonly<Order>) => Partial<Order>,
  ): Promise<StateChange<Order> | undefined> {
    const orderId = normalizeBusinessId(raw)
    return this.#exclusive(`order:${orderId}`, async () => {
      return this.#storage.transaction(() => {
        const stored = this.#storage.getOrder(orderId)
        if (!stored) throw new EntityNotFoundError(orderId)
        const before = detached(stored)
        const input = deepFreeze(detached(before))
        if (!predicate(input)) return undefined
        const proposed = patch(input)
        const after: Order = {
          ...before,
          ...detached(proposed),
          orderId,
          version: before.version + 1,
          updatedAt: this.#clock.now().toISOString(),
        }
        this.#storage.replaceOrder(detached(after), before.version)
        return this.#change(before, after, 'order.updated', orderId)
      })
    })
  }

  updateLogistics(
    raw: string,
    patch: (current: Readonly<Logistics>) => Partial<Logistics>,
  ): Promise<StateChange<Logistics>> {
    return this.#update(
      raw,
      'orderId',
      (id) => this.#storage.getLogistics(id),
      (record, expected) => this.#storage.replaceLogistics(record, expected),
      patch,
      'logistics.updated',
      true,
    )
  }

  updateInventory(
    raw: string,
    patch: (current: Readonly<Inventory>) => Partial<Inventory>,
  ): Promise<StateChange<Inventory>> {
    return this.#update(
      raw,
      'sku',
      (id) => this.#storage.getInventory(id),
      (record, expected) => this.#storage.replaceInventory(record, expected),
      patch,
      'inventory.changed',
      true,
      (next) => {
        if (next.stock < 0) throw new Error('库存不能小于 0。')
      },
    )
  }

  async createInventory(input: CreateInventoryInput): Promise<StateChange<Inventory>> {
    const sku = normalizeBusinessId(input.sku)
    const now = this.#clock.now().toISOString()
    assertNonNegativeFinite(input.stock, '库存不能小于 0。')
    const record: Inventory = {
      sku,
      productName: nonBlank(input.productName, '商品名称'),
      stock: input.stock,
      updatedAt: now,
      version: 1,
    }
    return this.#create(
      sku,
      record,
      (value) => this.#storage.insertInventory(value),
      'inventory.changed',
    )
  }

  async createOrder(input: CreateOrderInput): Promise<StateChange<Order>> {
    const orderId = normalizeBusinessId(input.orderId)
    assertDateOnly(input.estimatedDelivery)
    if (input.items.length === 0) throw new Error('订单至少包含一件商品。')
    const items = input.items.map((item) => {
      const sku = normalizeBusinessId(item.sku)
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error('订单商品数量必须为正整数。')
      }
      assertNonNegativeFinite(item.unitPrice, '订单商品单价不能小于 0。')
      return { sku, quantity: item.quantity, unitPrice: item.unitPrice }
    })
    const totalAmount = items.reduce(
      (total, item) => total + item.quantity * item.unitPrice,
      0,
    )
    if (!Number.isFinite(totalAmount)) throw new Error('订单总金额必须是有限数。')
    const now = this.#clock.now().toISOString()
    const record: Order = {
      orderId,
      customerId: normalizeBusinessId(input.customerId),
      status: input.status,
      address: nonBlank(input.address, '收货地址'),
      estimatedDelivery: input.estimatedDelivery,
      items,
      totalAmount,
      createdAt: now,
      ...(input.status === 'delivered' ? { deliveredAt: now } : {}),
      updatedAt: now,
      version: 1,
    }
    return this.#create(
      orderId,
      record,
      (value) => this.#storage.insertOrder(value),
      'order.updated',
      () => {
        for (const item of items) {
          if (!this.#storage.getInventory(item.sku)) {
            throw new Error(`商品 ${item.sku} 不存在，无法加入订单。`)
          }
        }
      },
    )
  }

  async createLogistics(input: CreateLogisticsInput): Promise<StateChange<Logistics>> {
    const orderId = normalizeBusinessId(input.orderId)
    const now = this.#clock.now().toISOString()
    const record: Logistics = {
      orderId,
      status: input.status,
      currentStatus: LOGISTICS_STATUS_LABELS[input.status],
      events: [{
        time: now,
        location: nonBlank(input.location, '物流位置'),
        description: nonBlank(input.description, '物流描述'),
      }],
      updatedAt: now,
      version: 1,
    }
    return this.#create(
      orderId,
      record,
      (value) => this.#storage.insertLogistics(value),
      'logistics.updated',
      () => {
        if (!this.#storage.getOrder(orderId)) {
          throw new Error(`订单 ${orderId} 不存在，无法创建物流记录。`)
        }
        if (this.#storage.getLogistics(orderId)) {
          throw new EntityAlreadyExistsError(orderId)
        }
      },
    )
  }

  async createReturn(value: CreateReturnInput): Promise<StateChange<ReturnRequest>> {
    const change = await this.createReturnIf(value, () => true)
    return change!
  }

  async createReturnIf(
    value: CreateReturnInput,
    predicate: (
      order: Readonly<Order>,
      returns: readonly Readonly<ReturnRequest>[],
    ) => boolean,
  ): Promise<StateChange<ReturnRequest> | undefined> {
    const returnId = normalizeBusinessId(value.returnId)
    const orderId = normalizeBusinessId(value.orderId)
    const record: ReturnRequest = {
      returnId,
      orderId,
      reason: nonBlank(value.reason, '退货原因'),
      status: value.status,
      createdAt: this.#clock.now().toISOString(),
      version: 1,
    }
    return this.#exclusive(`order:${orderId}`, async () => {
      return this.#storage.transaction(() => {
        const order = this.#storage.getOrder(orderId)
        if (!order) throw new Error(`订单 ${orderId} 不存在，无法创建退货记录。`)
        const returns = this.#storage.listReturnsByOrder(orderId)
        if (!predicate(
          deepFreeze(detached(order)),
          deepFreeze(detached(returns)),
        )) return undefined
        const committed = detached(record)
        this.#storage.insertReturn(committed)
        return this.#change(null, committed, 'return.updated', returnId)
      })
    })
  }

  updateReturn(
    raw: string,
    patch: (current: Readonly<ReturnRequest>) => Partial<ReturnRequest>,
  ): Promise<StateChange<ReturnRequest>> {
    return this.#update(
      raw,
      'returnId',
      (id) => this.#storage.getReturn(id),
      (record, expected) => this.#storage.replaceReturn(record, expected),
      patch,
      'return.updated',
      false,
    )
  }

  async createRefund(value: CreateRefundInput): Promise<StateChange<Refund>> {
    const change = await this.createRefundIf(value, () => true)
    return change!
  }

  async createRefundIf(
    value: CreateRefundInput,
    predicate: (
      order: Readonly<Order>,
      returns: readonly Readonly<ReturnRequest>[],
      refunds: readonly Readonly<Refund>[],
    ) => boolean,
  ): Promise<StateChange<Refund> | undefined> {
    const refundId = normalizeBusinessId(value.refundId)
    const orderId = normalizeBusinessId(value.orderId)
    const returnId = value.returnId ? normalizeBusinessId(value.returnId) : undefined
    const record: Refund = {
      refundId,
      orderId,
      ...(returnId ? { returnId } : {}),
      amount: value.amount,
      reason: nonBlank(value.reason, '退款原因'),
      status: value.status,
      updatedAt: this.#clock.now().toISOString(),
      version: 1,
    }
    assertNonNegativeFinite(record.amount, '退款金额不能小于 0。')
    return this.#exclusive(`order:${orderId}`, async () => {
      return this.#storage.transaction(() => {
        const order = this.#storage.getOrder(orderId)
        if (!order) throw new Error(`订单 ${orderId} 不存在，无法创建退款记录。`)
        const returns = this.#storage.listReturnsByOrder(orderId)
        if (returnId) {
          const returned = this.#storage.getReturn(returnId)
          if (!returned) throw new Error(`退货记录 ${returnId} 不存在。`)
          if (returned.orderId !== orderId) {
            throw new Error(`退货记录 ${returnId} 不属于订单 ${orderId}。`)
          }
        }
        const refunds = this.#storage.listRefundsByOrder(orderId)
        if (!predicate(
          deepFreeze(detached(order)),
          deepFreeze(detached(returns)),
          deepFreeze(detached(refunds)),
        )) return undefined
        const committed = detached(record)
        this.#storage.insertRefund(committed)
        return this.#change(null, committed, 'refund.updated', refundId)
      })
    })
  }

  updateRefund(
    raw: string,
    patch: (current: Readonly<Refund>) => Partial<Refund>,
  ): Promise<StateChange<Refund>> {
    return this.#update(
      raw,
      'refundId',
      (id) => this.#storage.getRefund(id),
      (record, expected) => this.#storage.replaceRefund(record, expected),
      patch,
      'refund.updated',
      true,
      (next) => {
        if (next.amount < 0) throw new Error('退款金额不能小于 0。')
      },
    )
  }

  async advanceClock(hours: number): Promise<{
    before: string
    after: string
    event: CustomerDomainEvent
  }> {
    return this.#exclusive('clock', async () => {
      if (!(this.#clock instanceof MutableClock)) {
        throw new Error('当前时钟不支持前进。')
      }
      const before = this.#clock.now().toISOString()
      this.#clock.advanceHours(hours)
      const after = this.#clock.now().toISOString()
      const version = ++this.#clockVersion
      return {
        before,
        after,
        event: this.#event('clock.advanced', 'CLOCK', version, {
          hours,
          before,
          after,
        }),
      }
    })
  }

  #create<T extends Versioned>(
    id: string,
    record: T,
    insert: (record: T) => void,
    eventType: EntityEventType,
    validate?: () => void,
  ): Promise<StateChange<T>> {
    return this.#exclusive(`create:${id}`, async () => {
      return this.#storage.transaction(() => {
        validate?.()
        const committed = detached(record)
        insert(committed)
        return this.#change(null, committed, eventType, id)
      })
    })
  }

  #update<T extends Versioned>(
    raw: string,
    identity: keyof T,
    get: (id: string) => T | undefined,
    replace: (record: T, expectedVersion: number) => void,
    patch: (current: Readonly<T>) => Partial<T>,
    eventType: EntityEventType,
    hasUpdatedAt: boolean,
    validate?: (next: T) => void,
    queuePrefix = 'update',
  ): Promise<StateChange<T>> {
    const id = normalizeBusinessId(raw)
    return this.#exclusive(`${queuePrefix}:${id}`, async () => {
      return this.#storage.transaction(() => {
        const stored = get(id)
        if (!stored) throw new EntityNotFoundError(id)
        const before = detached(stored)
        const input = deepFreeze(detached(before))
        const proposed = patch(input)
        const after = {
          ...before,
          ...detached(proposed),
          [identity]: id,
          version: before.version + 1,
          ...(hasUpdatedAt ? { updatedAt: this.#clock.now().toISOString() } : {}),
        } as T
        validate?.(after)
        replace(detached(after), before.version)
        return this.#change(before, after, eventType, id)
      })
    })
  }

  #change<T>(
    before: T | null,
    after: T,
    type: EntityEventType,
    entityId: string,
  ): StateChange<T> {
    const beforeCopy = before === null ? null : detached(before)
    const afterCopy = detached(after)
    const version = (after as Versioned).version
    return {
      before: beforeCopy,
      after: afterCopy,
      event: this.#event(type, entityId, version, {
        before: beforeCopy,
        after: afterCopy,
      }),
    }
  }

  #event(
    type: CustomerDomainEvent['type'],
    entityId: string,
    version: number,
    payload: Record<string, unknown>,
  ): CustomerDomainEvent {
    return deepFreeze({
      eventId: this.#idFactory(),
      type,
      entityId,
      version,
      occurredAt: this.#clock.now().toISOString(),
      payload: detached(payload),
    })
  }

  #exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(key, tail)
    return run.finally(() => {
      if (this.#queues.get(key) === tail) this.#queues.delete(key)
    })
  }
}

export const name = 'customer-state'
export const inject = ['customerStorage'] as const

export function apply(ctx: Context, options: CustomerStateOptions = {}) {
  ctx.reflect.provide('customerState', new CustomerStateService(ctx, {
    ...options,
    storage: ctx.customerStorage,
  }))
}
