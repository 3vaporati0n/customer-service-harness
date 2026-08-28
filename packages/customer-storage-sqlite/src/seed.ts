import type { DatabaseSync } from 'node:sqlite'

import { createSeedState } from '@dsh-customer-service/domain'
import { encodeJson } from './codecs.js'

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK')
  } catch {}
}

function insertSeedData(db: DatabaseSync): void {
  const seed = createSeedState()
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      order_id, customer_id, status, address, estimated_delivery,
      items_json, total_amount, created_at, delivered_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const order of seed.orders.values()) {
    insertOrder.run(
      order.orderId,
      order.customerId,
      order.status,
      order.address,
      order.estimatedDelivery,
      encodeJson(order.items),
      order.totalAmount,
      order.createdAt,
      order.deliveredAt ?? null,
      order.updatedAt,
      order.version,
    )
  }

  const insertInventory = db.prepare(`
    INSERT INTO inventories (sku, product_name, stock, updated_at, version)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const inventory of seed.inventories.values()) {
    insertInventory.run(
      inventory.sku,
      inventory.productName,
      inventory.stock,
      inventory.updatedAt,
      inventory.version,
    )
  }

  const insertLogistics = db.prepare(`
    INSERT INTO logistics (order_id, status, current_status, events_json, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const logistics of seed.logistics.values()) {
    insertLogistics.run(
      logistics.orderId,
      logistics.status,
      logistics.currentStatus,
      encodeJson(logistics.events),
      logistics.updatedAt,
      logistics.version,
    )
  }
  db.prepare(
    "INSERT INTO customer_meta (key, value) VALUES ('seed_version', '1')",
  ).run()
}

export function ensureSeedData(db: DatabaseSync): void {
  const seeded = db.prepare(
    "SELECT value FROM customer_meta WHERE key = 'seed_version'",
  ).get()
  if (seeded !== undefined) return

  db.exec('BEGIN IMMEDIATE')
  try {
    insertSeedData(db)
    db.exec('COMMIT')
  } catch (error) {
    rollbackQuietly(db)
    throw error
  }
}

export function resetSeedData(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      DELETE FROM refunds;
      DELETE FROM return_requests;
      DELETE FROM logistics;
      DELETE FROM inventories;
      DELETE FROM orders;
      DELETE FROM customer_meta;
    `)
    insertSeedData(db)
    db.exec('COMMIT')
  } catch (error) {
    rollbackQuietly(db)
    throw error
  }
}
