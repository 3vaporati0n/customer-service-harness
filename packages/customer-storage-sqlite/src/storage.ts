import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  EntityAlreadyExistsError,
  StorageVersionConflictError,
  normalizeBusinessId,
  type CustomerStorage,
  type Inventory,
  type Logistics,
  type Order,
  type Refund,
  type ReturnRequest,
} from '@dsh-customer-service/domain'
import {
  decodeInventory,
  decodeLogistics,
  decodeOrder,
  decodeRefund,
  decodeReturn,
  encodeJson,
} from './codecs.js'
import { configureDatabase, migrateDatabase } from './schema.js'
import { ensureSeedData } from './seed.js'

export function validateDatabasePath(databasePath: string): string {
  if (!path.isAbsolute(databasePath) || path.extname(databasePath) !== '.db') {
    throw new Error('客服 SQLite 数据库必须使用绝对 .db 路径。')
  }
  return path.normalize(databasePath)
}

export class SqliteCustomerStorage implements CustomerStorage {
  readonly #db: DatabaseSync
  #closed = false
  #transactionDepth = 0

  constructor(databasePath: string) {
    const resolved = validateDatabasePath(databasePath)
    mkdirSync(path.dirname(resolved), { recursive: true })
    this.#db = new DatabaseSync(resolved)
    configureDatabase(this.#db)
    migrateDatabase(this.#db)
    ensureSeedData(this.#db)
  }

  transaction<T>(operation: () => T): T {
    this.#assertOpen()
    if (this.#transactionDepth > 0) return operation()
    this.#db.exec('BEGIN IMMEDIATE')
    this.#transactionDepth += 1
    try {
      const result = operation()
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.#db.exec('ROLLBACK')
      } catch {}
      throw error
    } finally {
      this.#transactionDepth -= 1
    }
  }

  getOrder(raw: string): Order | undefined {
    const row = this.#getRow('orders', 'order_id', raw)
    return row === undefined ? undefined : decodeOrder(row)
  }

  getLogistics(raw: string): Logistics | undefined {
    const row = this.#getRow('logistics', 'order_id', raw)
    return row === undefined ? undefined : decodeLogistics(row)
  }

  getInventory(raw: string): Inventory | undefined {
    const row = this.#db.prepare(`
      SELECT sku, product_name, stock, updated_at, version
      FROM inventories WHERE sku = ?
    `).get(normalizeBusinessId(raw)) as Record<string, unknown> | undefined
    return row === undefined ? undefined : decodeInventory(row)
  }

  getReturn(raw: string): ReturnRequest | undefined {
    const row = this.#getRow('return_requests', 'return_id', raw)
    return row === undefined ? undefined : decodeReturn(row)
  }

  getRefund(raw: string): Refund | undefined {
    const row = this.#getRow('refunds', 'refund_id', raw)
    return row === undefined ? undefined : decodeRefund(row)
  }

  listReturnsByOrder(rawOrderId: string): ReturnRequest[] {
    const rows = this.#db.prepare(`
      SELECT * FROM return_requests
      WHERE order_id = ? ORDER BY created_at DESC, return_id DESC
    `).all(normalizeBusinessId(rawOrderId)) as Record<string, unknown>[]
    return rows.map(decodeReturn)
  }

  listRefundsByOrder(rawOrderId: string): Refund[] {
    const rows = this.#db.prepare(`
      SELECT * FROM refunds
      WHERE order_id = ? ORDER BY updated_at DESC, refund_id DESC
    `).all(normalizeBusinessId(rawOrderId)) as Record<string, unknown>[]
    return rows.map(decodeRefund)
  }

  findReturnByOrder(rawOrderId: string): ReturnRequest | undefined {
    return this.listReturnsByOrder(rawOrderId)[0]
  }

  findRefundByOrder(rawOrderId: string): Refund | undefined {
    return this.listRefundsByOrder(rawOrderId)[0]
  }

  insertOrder(record: Order): void {
    const id = normalizeBusinessId(record.orderId)
    if (this.getOrder(id)) throw new EntityAlreadyExistsError(id)
    try {
      this.#db.prepare(`
        INSERT INTO orders (
          order_id, customer_id, status, address, estimated_delivery,
          items_json, total_amount, created_at, delivered_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        normalizeBusinessId(record.customerId),
        record.status,
        record.address,
        record.estimatedDelivery,
        encodeJson(record.items),
        record.totalAmount,
        record.createdAt,
        record.deliveredAt ?? null,
        record.updatedAt,
        record.version,
      )
    } catch (error) {
      if (this.#isUniqueConstraint(error)) throw new EntityAlreadyExistsError(id)
      throw error
    }
  }

  insertInventory(record: Inventory): void {
    const id = normalizeBusinessId(record.sku)
    if (this.getInventory(id)) throw new EntityAlreadyExistsError(id)
    try {
      this.#db.prepare(`
        INSERT INTO inventories (sku, product_name, stock, updated_at, version)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, record.productName, record.stock, record.updatedAt, record.version)
    } catch (error) {
      if (this.#isUniqueConstraint(error)) throw new EntityAlreadyExistsError(id)
      throw error
    }
  }

  insertLogistics(record: Logistics): void {
    const id = normalizeBusinessId(record.orderId)
    if (this.getLogistics(id)) throw new EntityAlreadyExistsError(id)
    try {
      this.#db.prepare(`
        INSERT INTO logistics (
          order_id, status, current_status, events_json, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        record.status,
        record.currentStatus,
        encodeJson(record.events),
        record.updatedAt,
        record.version,
      )
    } catch (error) {
      if (this.#isUniqueConstraint(error)) throw new EntityAlreadyExistsError(id)
      throw error
    }
  }

  insertReturn(record: ReturnRequest): void {
    const id = normalizeBusinessId(record.returnId)
    if (this.getReturn(id)) throw new EntityAlreadyExistsError(id)
    try {
      this.#db.prepare(`
        INSERT INTO return_requests (
          return_id, order_id, reason, status, created_at, version
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        normalizeBusinessId(record.orderId),
        record.reason,
        record.status,
        record.createdAt,
        record.version,
      )
    } catch (error) {
      if (this.#isUniqueConstraint(error)) throw new EntityAlreadyExistsError(id)
      throw error
    }
  }

  insertRefund(record: Refund): void {
    const id = normalizeBusinessId(record.refundId)
    if (this.getRefund(id)) throw new EntityAlreadyExistsError(id)
    try {
      this.#db.prepare(`
        INSERT INTO refunds (
          refund_id, order_id, return_id, amount, reason, status, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        normalizeBusinessId(record.orderId),
        record.returnId ? normalizeBusinessId(record.returnId) : null,
        record.amount,
        record.reason,
        record.status,
        record.updatedAt,
        record.version,
      )
    } catch (error) {
      if (this.#isUniqueConstraint(error)) throw new EntityAlreadyExistsError(id)
      throw error
    }
  }

  replaceOrder(record: Order, expectedVersion: number): void {
    this.#assertNextVersion(record.orderId, record.version, expectedVersion)
    const result = this.#db.prepare(`
      UPDATE orders SET
        customer_id = ?, status = ?, address = ?, estimated_delivery = ?,
        items_json = ?, total_amount = ?, created_at = ?, delivered_at = ?,
        updated_at = ?, version = ?
      WHERE order_id = ? AND version = ?
    `).run(
      record.customerId,
      record.status,
      record.address,
      record.estimatedDelivery,
      encodeJson(record.items),
      record.totalAmount,
      record.createdAt,
      record.deliveredAt ?? null,
      record.updatedAt,
      record.version,
      normalizeBusinessId(record.orderId),
      expectedVersion,
    )
    this.#assertChanged(result.changes, record.orderId, expectedVersion)
  }

  replaceLogistics(record: Logistics, expectedVersion: number): void {
    this.#assertNextVersion(record.orderId, record.version, expectedVersion)
    const result = this.#db.prepare(`
      UPDATE logistics SET
        status = ?, current_status = ?, events_json = ?, updated_at = ?, version = ?
      WHERE order_id = ? AND version = ?
    `).run(
      record.status,
      record.currentStatus,
      encodeJson(record.events),
      record.updatedAt,
      record.version,
      normalizeBusinessId(record.orderId),
      expectedVersion,
    )
    this.#assertChanged(result.changes, record.orderId, expectedVersion)
  }

  replaceInventory(record: Inventory, expectedVersion: number): void {
    this.#assertNextVersion(record.sku, record.version, expectedVersion)
    const result = this.#db.prepare(`
      UPDATE inventories
      SET product_name = ?, stock = ?, updated_at = ?, version = ?
      WHERE sku = ? AND version = ?
    `).run(
      record.productName,
      record.stock,
      record.updatedAt,
      record.version,
      normalizeBusinessId(record.sku),
      expectedVersion,
    )
    this.#assertChanged(result.changes, record.sku, expectedVersion)
  }

  replaceReturn(record: ReturnRequest, expectedVersion: number): void {
    this.#assertNextVersion(record.returnId, record.version, expectedVersion)
    const result = this.#db.prepare(`
      UPDATE return_requests SET
        order_id = ?, reason = ?, status = ?, created_at = ?, version = ?
      WHERE return_id = ? AND version = ?
    `).run(
      normalizeBusinessId(record.orderId),
      record.reason,
      record.status,
      record.createdAt,
      record.version,
      normalizeBusinessId(record.returnId),
      expectedVersion,
    )
    this.#assertChanged(result.changes, record.returnId, expectedVersion)
  }

  replaceRefund(record: Refund, expectedVersion: number): void {
    this.#assertNextVersion(record.refundId, record.version, expectedVersion)
    const result = this.#db.prepare(`
      UPDATE refunds SET
        order_id = ?, return_id = ?, amount = ?, reason = ?, status = ?,
        updated_at = ?, version = ?
      WHERE refund_id = ? AND version = ?
    `).run(
      normalizeBusinessId(record.orderId),
      record.returnId ? normalizeBusinessId(record.returnId) : null,
      record.amount,
      record.reason,
      record.status,
      record.updatedAt,
      record.version,
      normalizeBusinessId(record.refundId),
      expectedVersion,
    )
    this.#assertChanged(result.changes, record.refundId, expectedVersion)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  #getRow(table: string, identity: string, raw: string): Record<string, unknown> | undefined {
    this.#assertOpen()
    return this.#db.prepare(
      `SELECT * FROM ${table} WHERE ${identity} = ?`,
    ).get(normalizeBusinessId(raw)) as Record<string, unknown> | undefined
  }

  #assertNextVersion(id: string, version: number, expectedVersion: number): void {
    if (version !== expectedVersion + 1) {
      throw new StorageVersionConflictError(normalizeBusinessId(id), expectedVersion)
    }
  }

  #assertChanged(changes: number | bigint, id: string, expectedVersion: number): void {
    if (changes !== 1 && changes !== 1n) {
      throw new StorageVersionConflictError(normalizeBusinessId(id), expectedVersion)
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('客服 SQLite 数据库连接已经关闭。')
  }

  #isUniqueConstraint(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code
    return typeof code === 'string' && /CONSTRAINT_(PRIMARYKEY|UNIQUE)/.test(code)
  }

}
