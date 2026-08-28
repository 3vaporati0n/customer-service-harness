import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteCustomerStorage } from '../packages/customer-storage-sqlite/lib/index.js'
import {
  resolveAcceptanceDatabasePath,
  resolveMainCheckoutRoot,
  runDbCommand,
} from '../scripts/customer-db.mjs'

const temporaryDirectories = []

async function createProjectRoot() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'customer-db-command-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('customer database commands', () => {
  it('initializes and inspects the complete acceptance dataset', async () => {
    const projectRoot = await createProjectRoot()
    const initialized = await runDbCommand('init', { projectRoot })
    const report = await runDbCommand('inspect', { projectRoot })

    await expect(access(resolveAcceptanceDatabasePath(projectRoot))).resolves.toBeUndefined()
    expect(initialized.databasePath).toBe(resolveAcceptanceDatabasePath(projectRoot))
    expect(report).toMatchObject({
      schemaVersion: 3,
      seedVersion: 1,
      counts: {
        orders: 3,
        logistics: 3,
        inventories: 2,
        returns: 0,
        refunds: 0,
      },
    })
  })

  it('backs up and resets modified acceptance data', async () => {
    const projectRoot = await createProjectRoot()
    await runDbCommand('init', { projectRoot })
    const databasePath = resolveAcceptanceDatabasePath(projectRoot)
    const storage = new SqliteCustomerStorage(databasePath)
    const inventory = storage.getInventory('SKU-1002')
    storage.replaceInventory({ ...inventory, stock: 5, version: 2 }, 1)
    storage.close()

    const result = await runDbCommand('reset', {
      projectRoot,
      now: new Date('2026-08-27T08:09:10.000Z'),
    })
    const reopened = new SqliteCustomerStorage(databasePath)
    expect(reopened.getInventory('SKU-1002')).toMatchObject({ stock: 0, version: 1 })
    reopened.close()

    expect(path.basename(result.backupPath)).toBe('customer-service-20260827-080910.db')
    expect(await readdir(path.join(projectRoot, 'data/backups'))).toEqual([
      'customer-service-20260827-080910.db',
    ])
  })

  it('resolves a linked worktree back to the main checkout', () => {
    const mainRoot = resolveMainCheckoutRoot(process.cwd())
    expect(mainRoot).not.toContain(`${path.sep}.worktrees${path.sep}`)
    expect(resolveAcceptanceDatabasePath(mainRoot))
      .toBe(path.join(mainRoot, 'data/customer-service.db'))
  })

  it('rejects unknown commands and worktree database roots', async () => {
    const projectRoot = await createProjectRoot()
    await expect(runDbCommand('unknown', { projectRoot }))
      .rejects.toThrow('未知的客服数据库命令：unknown。')
    expect(() => resolveAcceptanceDatabasePath(
      path.join(projectRoot, '.worktrees/customer-service-sqlite'),
    )).toThrow('验收数据库不能创建在 Git worktree 中。')
  })
})
