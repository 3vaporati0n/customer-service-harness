import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CustomerStorageCorruptionError,
  EntityAlreadyExistsError,
  StorageVersionConflictError,
} from '@dsh-customer-service/domain'
import {
  apply as applyStorage,
  SqliteCustomerStorage,
  name,
} from '../src/index.ts'
import { migrateDatabase } from '../src/schema.ts'

const temporaryDirectories = []

async function createDatabasePath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'customer-sqlite-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'nested', 'customer-service.db')
}

function inventoryRecord() {
  return {
    sku: 'SKU-TEST-001',
    productName: '测试鼠标',
    stock: 20,
    updatedAt: '2026-08-28T02:00:00.000Z',
    version: 1,
  }
}

function orderRecord() {
  return {
    orderId: 'ORDER-TEST-001',
    customerId: 'CUSTOMER-TEST-001',
    status: 'processing',
    address: '苏州市工业园区',
    estimatedDelivery: '2026-09-01',
    items: [{ sku: 'SKU-TEST-001', quantity: 2, unitPrice: 99 }],
    totalAmount: 198,
    createdAt: '2026-08-28T02:00:00.000Z',
    updatedAt: '2026-08-28T02:00:00.000Z',
    version: 1,
  }
}

function logisticsRecord() {
  return {
    orderId: 'ORDER-TEST-001',
    status: 'pending_shipment',
    currentStatus: '待发货',
    events: [{
      time: '2026-08-28T02:00:00.000Z',
      location: '苏州仓库',
      description: '测试物流已创建',
    }],
    updatedAt: '2026-08-28T02:00:00.000Z',
    version: 1,
  }
}

function createVersionOneDatabase(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  db.exec(`
    CREATE TABLE return_requests (
      return_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL
    );
    CREATE TABLE refunds (
      refund_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      return_id TEXT,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL
    );
    PRAGMA user_version = 1;
  `)
  return db
}

function createVersionTwoDatabase(databasePath) {
  const db = createVersionOneDatabase(databasePath)
  db.exec(`
    CREATE UNIQUE INDEX return_requests_one_per_order_idx
      ON return_requests(order_id);
    CREATE UNIQUE INDEX refunds_one_per_order_idx
      ON refunds(order_id);
    INSERT INTO return_requests
      (return_id, order_id, reason, status, created_at, version)
    VALUES
      ('RETURN-V2', 'ORDER-1003', '历史退货', 'rejected', '2026-08-27T01:00:00.000Z', 1);
    INSERT INTO refunds
      (refund_id, order_id, return_id, amount, reason, status, updated_at, version)
    VALUES
      ('REFUND-V2', 'ORDER-1003', 'RETURN-V2', 258, '历史退款', 'failed',
       '2026-08-27T02:00:00.000Z', 1);
    PRAGMA user_version = 2;
  `)
  return db
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('SqliteCustomerStorage', () => {
  it('persists newly inserted inventory, order, and logistics after reopening', async () => {
    const databasePath = await createDatabasePath()
    const inventory = inventoryRecord()
    const order = orderRecord()
    const logistics = logisticsRecord()
    const first = new SqliteCustomerStorage(databasePath)
    first.transaction(() => {
      first.insertInventory(inventory)
      first.insertOrder(order)
      first.insertLogistics(logistics)
    })
    first.close()

    const reopened = new SqliteCustomerStorage(databasePath)
    expect(reopened.getInventory('SKU-TEST-001')).toEqual(inventory)
    expect(reopened.getOrder('ORDER-TEST-001')).toEqual(order)
    expect(reopened.getLogistics('ORDER-TEST-001')).toEqual(logistics)
    reopened.close()
  })

  it('converts primary-key uniqueness into EntityAlreadyExistsError', async () => {
    const databasePath = await createDatabasePath()
    const inventory = inventoryRecord()
    const storage = new SqliteCustomerStorage(databasePath)
    storage.insertInventory(inventory)
    expect(() => storage.insertInventory(inventory))
      .toThrow('业务实体 SKU-TEST-001 已存在。')
    storage.close()
  })

  it('rolls a failed multi-insert transaction back', async () => {
    const databasePath = await createDatabasePath()
    const inventory = inventoryRecord()
    const order = orderRecord()
    const storage = new SqliteCustomerStorage(databasePath)
    expect(() => storage.transaction(() => {
      storage.insertInventory(inventory)
      storage.insertOrder(order)
      throw new Error('rollback')
    })).toThrow('rollback')
    expect(storage.getInventory('SKU-TEST-001')).toBeUndefined()
    expect(storage.getOrder('ORDER-TEST-001')).toBeUndefined()
    storage.close()
  })

  it('migrates a valid version-1 database to version 3', async () => {
    const databasePath = await createDatabasePath()
    const db = createVersionOneDatabase(databasePath)
    migrateDatabase(db)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
    db.close()
  })

  it('migrates version-1 duplicate returns without deleting data', async () => {
    const databasePath = await createDatabasePath()
    const db = createVersionOneDatabase(databasePath)
    const insert = db.prepare(`
      INSERT INTO return_requests
        (return_id, order_id, reason, status, created_at, version)
      VALUES (?, 'ORDER-1001', '测试', 'approved', '2026-08-28T02:00:00.000Z', 1)
    `)
    insert.run('RETURN-A')
    insert.run('RETURN-B')
    expect(() => migrateDatabase(db)).not.toThrow()
    expect(db.prepare('SELECT COUNT(*) AS count FROM return_requests').get())
      .toEqual({ count: 2 })
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
    db.close()
  })

  it('migrates a real version-2 database to version 3 without losing rows', async () => {
    const databasePath = await createDatabasePath()
    const db = createVersionTwoDatabase(databasePath)
    migrateDatabase(db)

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
    expect(db.prepare('SELECT return_id, status FROM return_requests').all())
      .toEqual([{ return_id: 'RETURN-V2', status: 'rejected' }])
    expect(db.prepare('SELECT refund_id, status FROM refunds').all())
      .toEqual([{ refund_id: 'REFUND-V2', status: 'failed' }])
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index'
        AND name IN ('return_requests_one_per_order_idx', 'refunds_one_per_order_idx')
    `).all()).toEqual([])
    db.close()
  })

  it('provides customerStorage and returns an idempotent disposer', async () => {
    const databasePath = await createDatabasePath()
    const provided = new Map()
    const dispose = applyStorage({
      reflect: {
        provide(key, value) {
          provided.set(key, value)
        },
      },
    }, { databasePath })

    expect(name).toBe('customer-sqlite-storage')
    expect(provided.get('customerStorage')).toBeInstanceOf(SqliteCustomerStorage)
    expect(() => dispose()).not.toThrow()
    expect(() => dispose()).not.toThrow()
  })

  it('rejects relative or non-database paths', () => {
    expect(() => new SqliteCustomerStorage('data/customer-service.db'))
      .toThrow('客服 SQLite 数据库必须使用绝对 .db 路径。')
    expect(() => new SqliteCustomerStorage('/tmp/customer-service.sqlite'))
      .toThrow('客服 SQLite 数据库必须使用绝对 .db 路径。')
  })

  it('creates schema and seeds a new database exactly once', async () => {
    const databasePath = await createDatabasePath()
    const first = new SqliteCustomerStorage(databasePath)
    const initial = first.getInventory('SKU-1002')
    expect(initial).toMatchObject({ stock: 0, version: 1 })
    first.replaceInventory({ ...initial, stock: 5, version: 2 }, 1)
    first.close()

    const reopened = new SqliteCustomerStorage(databasePath)
    expect(reopened.getInventory('SKU-1002')).toMatchObject({ stock: 5, version: 2 })
    reopened.close()
  })

  it('persists all five entity types and supports order lookups', async () => {
    const databasePath = await createDatabasePath()
    const storage = new SqliteCustomerStorage(databasePath)
    const order = storage.getOrder('ORDER-1001')
    const logistics = storage.getLogistics('ORDER-1001')
    const inventory = storage.getInventory('SKU-1001')

    storage.transaction(() => {
      storage.replaceOrder({ ...order, address: '新地址', version: 2 }, 1)
      storage.replaceLogistics({
        ...logistics,
        currentStatus: '派送中',
        events: [...logistics.events, {
          time: '2026-08-27 16:00',
          location: '苏州营业点',
          description: '正在派送',
        }],
        version: 2,
      }, 1)
      storage.replaceInventory({ ...inventory, stock: 9, version: 2 }, 1)
      storage.insertReturn({
        returnId: 'RETURN-2001',
        orderId: 'ORDER-1003',
        reason: '尺寸不合适',
        status: 'approved',
        createdAt: '2026-08-27T16:00:00+08:00',
        version: 1,
      })
      storage.insertRefund({
        refundId: 'REFUND-2001',
        orderId: 'ORDER-1003',
        returnId: 'RETURN-2001',
        amount: 258,
        reason: '退货退款',
        status: 'pending',
        updatedAt: '2026-08-27T16:00:00+08:00',
        version: 1,
      })
    })
    storage.replaceReturn({ ...storage.getReturn('RETURN-2001'), status: 'received', version: 2 }, 1)
    storage.replaceRefund({ ...storage.getRefund('REFUND-2001'), status: 'processing', version: 2 }, 1)
    storage.close()

    const reopened = new SqliteCustomerStorage(databasePath)
    expect(reopened.getOrder('ORDER-1001')).toMatchObject({ address: '新地址', version: 2 })
    expect(reopened.getLogistics('ORDER-1001')).toMatchObject({ currentStatus: '派送中', version: 2 })
    expect(reopened.getInventory('SKU-1001')).toMatchObject({ stock: 9, version: 2 })
    expect(reopened.findReturnByOrder('ORDER-1003')).toMatchObject({
      returnId: 'RETURN-2001', status: 'received', version: 2,
    })
    expect(reopened.findRefundByOrder('ORDER-1003')).toMatchObject({
      refundId: 'REFUND-2001', status: 'processing', version: 2,
    })
    reopened.close()
  })

  it('lists multiple returns and refunds for one order as detached newest-first rows', async () => {
    const databasePath = await createDatabasePath()
    const storage = new SqliteCustomerStorage(databasePath)
    storage.insertReturn({
      returnId: 'RETURN-A', orderId: 'ORDER-1003', reason: '第一次',
      status: 'rejected', createdAt: '2026-08-27T01:00:00.000Z', version: 1,
    })
    storage.insertReturn({
      returnId: 'RETURN-B', orderId: 'ORDER-1003', reason: '第二次',
      status: 'approved', createdAt: '2026-08-27T02:00:00.000Z', version: 1,
    })
    storage.insertRefund({
      refundId: 'REFUND-A', orderId: 'ORDER-1003', returnId: 'RETURN-A',
      amount: 258, reason: '第一次', status: 'failed',
      updatedAt: '2026-08-27T03:00:00.000Z', version: 1,
    })
    storage.insertRefund({
      refundId: 'REFUND-B', orderId: 'ORDER-1003', returnId: 'RETURN-B',
      amount: 258, reason: '第二次', status: 'pending',
      updatedAt: '2026-08-27T04:00:00.000Z', version: 1,
    })

    const returns = storage.listReturnsByOrder('order-1003')
    const refunds = storage.listRefundsByOrder('order-1003')
    returns[0].reason = '外部篡改'
    refunds[0].reason = '外部篡改'
    expect(returns.map((item) => item.returnId)).toEqual(['RETURN-B', 'RETURN-A'])
    expect(refunds.map((item) => item.refundId)).toEqual(['REFUND-B', 'REFUND-A'])
    expect(storage.findReturnByOrder('ORDER-1003').reason).toBe('第二次')
    expect(storage.findRefundByOrder('ORDER-1003').reason).toBe('第二次')
    storage.close()
  })

  it('rolls back every write when a transaction fails', async () => {
    const databasePath = await createDatabasePath()
    const storage = new SqliteCustomerStorage(databasePath)

    expect(() => storage.transaction(() => {
      storage.insertReturn({
        returnId: 'RETURN-ROLLBACK',
        orderId: 'ORDER-1003',
        reason: '测试回滚',
        status: 'approved',
        createdAt: '2026-08-27T16:00:00+08:00',
        version: 1,
      })
      throw new Error('主动失败')
    })).toThrow('主动失败')
    expect(storage.getReturn('RETURN-ROLLBACK')).toBeUndefined()
    storage.close()
  })

  it('rejects duplicate, stale-version, and constraint-violating writes', async () => {
    const databasePath = await createDatabasePath()
    const storage = new SqliteCustomerStorage(databasePath)
    const inventory = storage.getInventory('SKU-1002')
    const returned = {
      returnId: 'RETURN-ERROR',
      orderId: 'ORDER-1003',
      reason: '测试错误',
      status: 'approved',
      createdAt: '2026-08-27T16:00:00+08:00',
      version: 1,
    }
    storage.insertReturn(returned)

    expect(() => storage.insertReturn(returned)).toThrow(EntityAlreadyExistsError)
    expect(() => storage.replaceInventory({ ...inventory, stock: 1, version: 2 }, 9))
      .toThrow(StorageVersionConflictError)
    expect(() => storage.replaceInventory({ ...inventory, stock: -1, version: 2 }, 1))
      .toThrow()
    expect(storage.getInventory('SKU-1002')).toMatchObject({ stock: 0, version: 1 })
    storage.close()
  })

  it('returns detached nested values and reports malformed JSON', async () => {
    const databasePath = await createDatabasePath()
    const storage = new SqliteCustomerStorage(databasePath)
    const order = storage.getOrder('ORDER-1001')
    const logistics = storage.getLogistics('ORDER-1001')
    order.items[0].quantity = 99
    logistics.events[0].description = '外部篡改'
    expect(storage.getOrder('ORDER-1001').items[0].quantity).toBe(1)
    expect(storage.getLogistics('ORDER-1001').events[0].description).toBe('包裹已发出')
    storage.close()

    const database = new DatabaseSync(databasePath)
    database.prepare("UPDATE orders SET items_json = 'not-json' WHERE order_id = 'ORDER-1001'").run()
    database.close()

    const corrupted = new SqliteCustomerStorage(databasePath)
    expect(() => corrupted.getOrder('ORDER-1001')).toThrow(CustomerStorageCorruptionError)
    corrupted.close()
  })
})
