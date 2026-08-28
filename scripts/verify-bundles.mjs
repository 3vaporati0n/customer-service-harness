import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parse } from 'yaml'

const PRODUCTION_NAMES = [
  '@dsh-customer-service/storage-sqlite',
  '@dsh-customer-service/state',
  '@dsh-customer-service/events',
  '@dsh-customer-service/approval',
  'dsh-plugin-customer-query-order',
  'dsh-plugin-customer-query-logistics',
  'dsh-plugin-customer-query-inventory',
  'dsh-plugin-customer-cancel-order',
  'dsh-plugin-customer-return-order',
  'dsh-plugin-customer-refund-order',
  'dsh-plugin-customer-change-address',
  'dsh-plugin-customer-refund-progress-alert',
]
const DEMO_NAMES = [
  'dsh-plugin-customer-mock-operations',
  'dsh-plugin-customer-test-data-entry',
]

export function parseBundlePatch(text) {
  const document = parse(text)
  const modules = document?.[0]?.insert
  if (!Array.isArray(modules)) throw new Error('Bundle Patch 必须包含一个 insert 列表。')
  const ids = new Set()
  const names = new Set()
  for (const module of modules) {
    if (typeof module?.id !== 'string' || typeof module?.name !== 'string') {
      throw new Error('Bundle Patch 模块必须包含字符串 id 和 name。')
    }
    if (ids.has(module.id)) throw new Error(`Bundle Patch 包含重复 id：${module.id}。`)
    if (names.has(module.name)) throw new Error(`Bundle Patch 包含重复包名：${module.name}。`)
    ids.add(module.id)
    names.add(module.name)
  }
  return modules.map(({ id, name }) => ({ id, name }))
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function verifyBundles(root) {
  const productionDir = path.join(root, 'bundles/customer-service-suite')
  const demoDir = path.join(root, 'bundles/customer-service-demo')
  const production = parseBundlePatch(
    await readFile(path.join(productionDir, 'cordis.patch.yml'), 'utf8'),
  )
  const demo = parseBundlePatch(
    await readFile(path.join(demoDir, 'cordis.patch.yml'), 'utf8'),
  )
  const productionPackage = await readJson(path.join(productionDir, 'package.json'))
  const demoPackage = await readJson(path.join(demoDir, 'package.json'))

  if (production.map((item) => item.name).join('\n') !== PRODUCTION_NAMES.join('\n')) {
    throw new Error('生产 Bundle 的模块顺序不符合契约。')
  }
  if (demo.map((item) => item.name).join('\n') !== [...PRODUCTION_NAMES, ...DEMO_NAMES].join('\n')) {
    throw new Error('演示 Bundle 的模块顺序不符合契约。')
  }
  for (const item of production) {
    if (productionPackage.dependencies?.[item.name] !== 'workspace:^') {
      throw new Error(`生产 Bundle 缺少 workspace 依赖：${item.name}。`)
    }
  }
  for (const item of demo) {
    if (demoPackage.dependencies?.[item.name] !== 'workspace:^') {
      throw new Error(`演示 Bundle 缺少 workspace 依赖：${item.name}。`)
    }
  }
  return { production, demo }
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false

if (invoked) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const summary = await verifyBundles(root)
  console.log(`Bundle verification passed: production=${summary.production.length}, demo=${summary.demo.length}`)
}
