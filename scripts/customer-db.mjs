import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  initializeCustomerDatabase,
  inspectCustomerDatabase,
  resetCustomerDatabase,
} from '../packages/customer-storage-sqlite/lib/index.js'
import {
  resolveAcceptanceDatabasePath,
  resolveMainCheckoutRoot,
} from './project-paths.mjs'

export { resolveAcceptanceDatabasePath, resolveMainCheckoutRoot }

function backupFileName(now) {
  const timestamp = now.toISOString().replace(/\D/g, '').slice(0, 14)
  return `customer-service-${timestamp.slice(0, 8)}-${timestamp.slice(8)}.db`
}

export async function runDbCommand(command, options = {}) {
  const projectRoot = path.resolve(
    options.projectRoot ?? resolveMainCheckoutRoot(options.cwd ?? process.cwd()),
  )
  const databasePath = resolveAcceptanceDatabasePath(projectRoot)
  if (command === 'init') return initializeCustomerDatabase(databasePath)
  if (command === 'inspect') return inspectCustomerDatabase(databasePath)
  if (command === 'reset') {
    const backupPath = path.join(
      projectRoot,
      'data/backups',
      backupFileName(options.now ?? new Date()),
    )
    const inspection = resetCustomerDatabase(databasePath, backupPath)
    return { ...inspection, backupPath }
  }
  throw new Error(`未知的客服数据库命令：${command}。`)
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false

if (invoked) {
  const result = await runDbCommand(process.argv[2])
  console.log(JSON.stringify(result, null, 2))
}
