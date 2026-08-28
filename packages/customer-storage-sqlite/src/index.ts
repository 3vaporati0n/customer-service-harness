import type { Context } from '@deepseek-ai/cordis'
import type { CustomerStorage } from '@dsh-customer-service/domain'

import { SqliteCustomerStorage } from './storage.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customerStorage: CustomerStorage
  }
}

export interface SqliteStorageConfig {
  databasePath: string
}

export const name = 'customer-sqlite-storage'

export { SqliteCustomerStorage } from './storage.js'
export { SCHEMA_VERSION } from './schema.js'
export {
  initializeCustomerDatabase,
  inspectCustomerDatabase,
  resetCustomerDatabase,
  type CustomerDatabaseInspection,
} from './lifecycle.js'

export function apply(ctx: Context, config: SqliteStorageConfig) {
  const storage = new SqliteCustomerStorage(config.databasePath)
  ctx.reflect.provide('customerStorage', storage)
  return () => storage.close()
}
