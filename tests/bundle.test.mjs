import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseBundlePatch, verifyBundles } from '../scripts/verify-bundles.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('customer service bundles', () => {
  it('exports service plugins as Cordis module namespaces', async () => {
    const plugins = [
      ['@dsh-customer-service/storage-sqlite', '../packages/customer-storage-sqlite/lib/index.js', []],
      ['@dsh-customer-service/state', '../packages/customer-state/lib/index.js', ['customerStorage']],
      ['@dsh-customer-service/events', '../packages/customer-events/lib/index.js', ['agents']],
      ['@dsh-customer-service/approval', '../packages/customer-approval/lib/index.js', ['tools']],
    ]

    for (const [packageName, modulePath, expectedInject] of plugins) {
      const plugin = await import(new URL(modulePath, import.meta.url))
      expect(plugin, packageName).not.toHaveProperty('default')
      expect(plugin.apply, packageName).toBeTypeOf('function')
      expect(plugin.inject ?? [], packageName).toEqual(expectedInject)
    }
  })

  it('loads production modules once in dependency order', async () => {
    const text = await readFile(
      new URL('../bundles/customer-service-suite/cordis.patch.yml', import.meta.url),
      'utf8',
    )
    expect(parseBundlePatch(text)).toEqual([
      {
        id: 'customer-sqlite-storage',
        name: '@dsh-customer-service/storage-sqlite',
      },
      { id: 'customer-state', name: '@dsh-customer-service/state' },
      { id: 'customer-events', name: '@dsh-customer-service/events' },
      { id: 'customer-approval', name: '@dsh-customer-service/approval' },
      { id: 'customer-query-order', name: 'dsh-plugin-customer-query-order' },
      { id: 'customer-query-logistics', name: 'dsh-plugin-customer-query-logistics' },
      { id: 'customer-query-inventory', name: 'dsh-plugin-customer-query-inventory' },
      { id: 'customer-cancel-order', name: 'dsh-plugin-customer-cancel-order' },
      { id: 'customer-return-order', name: 'dsh-plugin-customer-return-order' },
      { id: 'customer-refund-order', name: 'dsh-plugin-customer-refund-order' },
      { id: 'customer-change-address', name: 'dsh-plugin-customer-change-address' },
      {
        id: 'customer-refund-progress-alert',
        name: 'dsh-plugin-customer-refund-progress-alert',
      },
    ])
  })

  it('adds only mock and test-data plugins on top of production', async () => {
    const summary = await verifyBundles(root)
    expect(summary.production).toHaveLength(12)
    expect(summary.demo).toHaveLength(14)
    expect(summary.production.some((item) => item.name.includes('mock'))).toBe(false)
    expect(summary.production.some((item) => item.name.includes('test-data'))).toBe(false)
    expect(summary.demo.slice(-2)).toEqual([
      {
        id: 'customer-mock-operations',
        name: 'dsh-plugin-customer-mock-operations',
      },
      {
        id: 'customer-test-data-entry',
        name: 'dsh-plugin-customer-test-data-entry',
      },
    ])
  })

  it('rejects duplicate ids and package names', () => {
    expect(() => parseBundlePatch(`
- insert:
    - id: duplicate
      name: package-a
    - id: duplicate
      name: package-a
`)).toThrow('Bundle Patch 包含重复 id：duplicate。')
  })
})
