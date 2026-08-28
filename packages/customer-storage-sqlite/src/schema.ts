import type { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 3

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK')
  } catch {}
}

export function configureDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
}

export function migrateDatabase(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (row.user_version > SCHEMA_VERSION) {
    throw new Error(`客服数据库结构版本 ${row.user_version} 高于当前支持版本 ${SCHEMA_VERSION}。`)
  }
  if (row.user_version < 1) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
      CREATE TABLE orders (
        order_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        address TEXT NOT NULL,
        estimated_delivery TEXT NOT NULL,
        items_json TEXT NOT NULL,
        total_amount REAL NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0)
      );
      CREATE TABLE inventories (
        sku TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        stock INTEGER NOT NULL CHECK (stock >= 0),
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0)
      );
      CREATE TABLE logistics (
        order_id TEXT PRIMARY KEY REFERENCES orders(order_id),
        status TEXT NOT NULL,
        current_status TEXT NOT NULL,
        events_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0)
      );
      CREATE TABLE return_requests (
        return_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(order_id),
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0)
      );
      CREATE INDEX return_requests_order_id_idx ON return_requests(order_id);
      CREATE TABLE refunds (
        refund_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(order_id),
        return_id TEXT REFERENCES return_requests(return_id),
        amount REAL NOT NULL CHECK (amount >= 0),
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0)
      );
      CREATE INDEX refunds_order_id_idx ON refunds(order_id);
      CREATE TABLE customer_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      `)
      db.exec('COMMIT')
    } catch (error) {
      rollbackQuietly(db)
      throw error
    }
  }

  if (row.user_version < 2) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        PRAGMA user_version = 2;
      `)
      db.exec('COMMIT')
    } catch (error) {
      rollbackQuietly(db)
      throw error
    }
  }

  if (row.user_version < 3) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        DROP INDEX IF EXISTS return_requests_one_per_order_idx;
        DROP INDEX IF EXISTS refunds_one_per_order_idx;
        PRAGMA user_version = 3;
      `)
      db.exec('COMMIT')
    } catch (error) {
      rollbackQuietly(db)
      throw error
    }
  }
}
