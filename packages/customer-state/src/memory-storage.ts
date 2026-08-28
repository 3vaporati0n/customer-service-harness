import {
  EntityAlreadyExistsError,
  StorageVersionConflictError,
  createSeedState,
  normalizeBusinessId,
  type CustomerStorage,
  type Inventory,
  type Logistics,
  type Order,
  type Refund,
  type ReturnRequest,
  type SeedState,
} from '@dsh-customer-service/domain'

type Versioned = { version: number }

function clone<T>(value: T): T {
  return structuredClone(value)
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source].map(([key, value]) => [key, clone(value)]))
}

export class MemoryCustomerStorage implements CustomerStorage {
  readonly #orders: Map<string, Order>
  readonly #inventories: Map<string, Inventory>
  readonly #logistics: Map<string, Logistics>
  readonly #returns: Map<string, ReturnRequest>
  readonly #refunds: Map<string, Refund>
  #transactionDepth = 0

  constructor(seed: SeedState = createSeedState()) {
    this.#orders = cloneMap(seed.orders)
    this.#inventories = cloneMap(seed.inventories)
    this.#logistics = cloneMap(seed.logistics)
    this.#returns = cloneMap(seed.returns)
    this.#refunds = cloneMap(seed.refunds)
  }

  transaction<T>(operation: () => T): T {
    if (this.#transactionDepth > 0) return operation()
    const snapshot = this.#snapshot()
    this.#transactionDepth += 1
    try {
      return operation()
    } catch (error) {
      this.#restore(snapshot)
      throw error
    } finally {
      this.#transactionDepth -= 1
    }
  }

  getOrder(id: string): Order | undefined {
    return this.#get(this.#orders, id)
  }

  getLogistics(id: string): Logistics | undefined {
    return this.#get(this.#logistics, id)
  }

  getInventory(id: string): Inventory | undefined {
    return this.#get(this.#inventories, id)
  }

  getReturn(id: string): ReturnRequest | undefined {
    return this.#get(this.#returns, id)
  }

  getRefund(id: string): Refund | undefined {
    return this.#get(this.#refunds, id)
  }

  listReturnsByOrder(orderId: string): ReturnRequest[] {
    return this.#listByOrder(this.#returns, orderId, 'createdAt', 'returnId')
  }

  listRefundsByOrder(orderId: string): Refund[] {
    return this.#listByOrder(this.#refunds, orderId, 'updatedAt', 'refundId')
  }

  findReturnByOrder(orderId: string): ReturnRequest | undefined {
    return this.listReturnsByOrder(orderId)[0]
  }

  findRefundByOrder(orderId: string): Refund | undefined {
    return this.listRefundsByOrder(orderId)[0]
  }

  insertOrder(record: Order): void {
    this.#insert(this.#orders, record.orderId, record)
  }

  insertInventory(record: Inventory): void {
    this.#insert(this.#inventories, record.sku, record)
  }

  insertLogistics(record: Logistics): void {
    this.#insert(this.#logistics, record.orderId, record)
  }

  insertReturn(record: ReturnRequest): void {
    this.#insert(this.#returns, record.returnId, record)
  }

  insertRefund(record: Refund): void {
    this.#insert(this.#refunds, record.refundId, record)
  }

  replaceOrder(record: Order, expectedVersion: number): void {
    this.#replace(this.#orders, record.orderId, record, expectedVersion)
  }

  replaceLogistics(record: Logistics, expectedVersion: number): void {
    this.#replace(this.#logistics, record.orderId, record, expectedVersion)
  }

  replaceInventory(record: Inventory, expectedVersion: number): void {
    this.#replace(this.#inventories, record.sku, record, expectedVersion)
  }

  replaceReturn(record: ReturnRequest, expectedVersion: number): void {
    this.#replace(this.#returns, record.returnId, record, expectedVersion)
  }

  replaceRefund(record: Refund, expectedVersion: number): void {
    this.#replace(this.#refunds, record.refundId, record, expectedVersion)
  }

  close(): void {}

  #get<T>(store: Map<string, T>, raw: string): T | undefined {
    const value = store.get(normalizeBusinessId(raw))
    return value === undefined ? undefined : clone(value)
  }

  #listByOrder<T extends { orderId: string }>(
    store: Map<string, T>,
    rawOrderId: string,
    timestamp: keyof T,
    identity: keyof T,
  ): T[] {
    const orderId = normalizeBusinessId(rawOrderId)
    return [...store.values()]
      .filter((item) => item.orderId === orderId)
      .sort((left, right) => {
        const byTime = String(right[timestamp]).localeCompare(String(left[timestamp]))
        if (byTime !== 0) return byTime
        return String(right[identity]).localeCompare(String(left[identity]))
      })
      .map(clone)
  }

  #insert<T>(store: Map<string, T>, raw: string, record: T): void {
    const id = normalizeBusinessId(raw)
    if (store.has(id)) throw new EntityAlreadyExistsError(id)
    store.set(id, clone(record))
  }

  #replace<T extends Versioned>(
    store: Map<string, T>,
    raw: string,
    record: T,
    expectedVersion: number,
  ): void {
    const id = normalizeBusinessId(raw)
    const current = store.get(id)
    if (!current || current.version !== expectedVersion || record.version !== expectedVersion + 1) {
      throw new StorageVersionConflictError(id, expectedVersion)
    }
    store.set(id, clone(record))
  }

  #snapshot(): SeedState {
    return {
      orders: cloneMap(this.#orders),
      inventories: cloneMap(this.#inventories),
      logistics: cloneMap(this.#logistics),
      returns: cloneMap(this.#returns),
      refunds: cloneMap(this.#refunds),
    }
  }

  #restore(snapshot: SeedState): void {
    this.#restoreMap(this.#orders, snapshot.orders)
    this.#restoreMap(this.#inventories, snapshot.inventories)
    this.#restoreMap(this.#logistics, snapshot.logistics)
    this.#restoreMap(this.#returns, snapshot.returns)
    this.#restoreMap(this.#refunds, snapshot.refunds)
  }

  #restoreMap<T>(target: Map<string, T>, source: Map<string, T>): void {
    target.clear()
    for (const [key, value] of source) target.set(key, clone(value))
  }
}
