import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { CustomerStorageCorruptionError } from '@dsh-customer-service/domain'
import { configureDatabase, migrateDatabase } from './schema.js'
import { resetSeedData } from './seed.js'
import { SqliteCustomerStorage, validateDatabasePath } from './storage.js'

export interface CustomerDatabaseInspection {
  databasePath: string
  schemaVersion: number
  seedVersion: number
  counts: {
    orders: number
    logistics: number
    inventories: number
    returns: number
    refunds: number
  }
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number
  }
  return row.count
}

export function initializeCustomerDatabase(databasePath: string): CustomerDatabaseInspection {
  const storage = new SqliteCustomerStorage(databasePath)
  storage.close()
  return inspectCustomerDatabase(databasePath)
}

export function inspectCustomerDatabase(databasePath: string): CustomerDatabaseInspection {
  const resolved = validateDatabasePath(databasePath)
  const db = new DatabaseSync(resolved)
  try {
    configureDatabase(db)
    migrateDatabase(db)
    const schema = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const seed = db.prepare(
      "SELECT value FROM customer_meta WHERE key = 'seed_version'",
    ).get() as { value: string } | undefined
    const seedVersion = Number(seed?.value)
    if (!Number.isInteger(seedVersion)) throw new CustomerStorageCorruptionError('seed_version')
    return {
      databasePath: resolved,
      schemaVersion: schema.user_version,
      seedVersion,
      counts: {
        orders: count(db, 'orders'),
        logistics: count(db, 'logistics'),
        inventories: count(db, 'inventories'),
        returns: count(db, 'return_requests'),
        refunds: count(db, 'refunds'),
      },
    }
  } finally {
    db.close()
  }
}

export function resetCustomerDatabase(
  databasePath: string,
  backupPath: string,
): CustomerDatabaseInspection {
  const resolved = validateDatabasePath(databasePath)
  const resolvedBackup = validateDatabasePath(backupPath)
  if (resolved === resolvedBackup) throw new Error('客服数据库备份路径不能与原数据库相同。')
  initializeCustomerDatabase(resolved)
  mkdirSync(path.dirname(resolvedBackup), { recursive: true })

  const db = new DatabaseSync(resolved)
  try {
    configureDatabase(db)
    db.exec('PRAGMA wal_checkpoint(FULL)')
    db.prepare('VACUUM INTO ?').run(resolvedBackup)
    resetSeedData(db)
  } finally {
    db.close()
  }
  return inspectCustomerDatabase(resolved)
}
