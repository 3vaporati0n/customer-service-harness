import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const VERSION = '0.1.0'

function artifactFile(name) {
  return `${name.replace(/^@/, '').replaceAll('/', '-')}-${VERSION}.tgz`
}

export function contentAddressedArtifactFile(file, sha256) {
  if (!file.endsWith('.tgz') || !/^[a-f0-9]{12,}$/i.test(sha256)) {
    throw new Error('无法生成内容寻址的 tarball 文件名。')
  }
  return `${file.slice(0, -4)}-${sha256.slice(0, 12).toLowerCase()}.tgz`
}

export const MODULES = [
  ['@dsh-customer-service/domain', 'packages/customer-domain', 'library'],
  ['@dsh-customer-service/storage-sqlite', 'packages/customer-storage-sqlite', 'library'],
  ['@dsh-customer-service/state', 'packages/customer-state', 'library'],
  ['@dsh-customer-service/events', 'packages/customer-events', 'library'],
  ['@dsh-customer-service/approval', 'packages/customer-approval', 'library'],
  ['dsh-plugin-customer-query-order', 'plugins/query-order', 'plugin'],
  ['dsh-plugin-customer-query-logistics', 'plugins/query-logistics', 'plugin'],
  ['dsh-plugin-customer-query-inventory', 'plugins/query-inventory', 'plugin'],
  ['dsh-plugin-customer-cancel-order', 'plugins/cancel-order', 'plugin'],
  ['dsh-plugin-customer-return-order', 'plugins/return-order', 'plugin'],
  ['dsh-plugin-customer-refund-order', 'plugins/refund-order', 'plugin'],
  ['dsh-plugin-customer-change-address', 'plugins/change-address', 'plugin'],
  ['dsh-plugin-customer-refund-progress-alert', 'plugins/refund-progress-alert', 'plugin'],
  ['dsh-plugin-customer-mock-operations', 'plugins/mock-operations', 'plugin'],
  ['dsh-plugin-customer-test-data-entry', 'plugins/test-data-entry', 'plugin'],
  ['dsh-bundle-customer-service-suite', 'bundles/customer-service-suite', 'bundle'],
  ['dsh-bundle-customer-service-demo', 'bundles/customer-service-demo', 'bundle'],
].map(([name, directory, kind]) => ({
  name,
  version: VERSION,
  directory,
  kind,
  file: artifactFile(name),
}))

export function assertSafeOutputPath(root, target) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const expected = path.join(resolvedRoot, 'dist', 'customer-service-suite')
  if (resolvedTarget !== expected || path.basename(resolvedTarget) !== 'customer-service-suite') {
    throw new Error('拒绝清理非客服套件输出目录。')
  }
  return resolvedTarget
}

export async function createManifestFromArtifacts(definitions, distDir) {
  const seen = new Set()
  const modules = []
  for (const definition of definitions) {
    if (seen.has(definition.name)) {
      throw new Error(`打包清单包含重复模块：${definition.name}。`)
    }
    seen.add(definition.name)
    let content
    try {
      content = await readFile(path.join(distDir, definition.file))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`缺少模块 tarball：${definition.file}。`)
      }
      throw error
    }
    modules.push({
      name: definition.name,
      version: definition.version,
      file: definition.file,
      kind: definition.kind,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }
  return { version: 1, modules }
}

export function buildInstallArgs(manifest) {
  const bundle = manifest.modules.find(
    (item) => item.name === 'dsh-bundle-customer-service-demo' && item.kind === 'bundle',
  )
  if (!bundle) throw new Error('打包清单缺少演示 Bundle。')
  return {
    dependencies: manifest.modules
      .filter((item) => item.kind === 'library')
      .map((item) => item.file),
    plugins: manifest.modules
      .filter((item) => item.kind === 'plugin')
      .map((item) => item.name),
    bundle: bundle.file,
  }
}

async function runPnpm(cwd, args) {
  return execFileAsync('npx', ['-y', 'pnpm@11.7.0', ...args], {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  })
}

export async function packageSuite(options = {}) {
  const suiteRoot = path.resolve(
    options.suiteRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  )
  const legacyRoot = path.join(suiteRoot, 'legacy/dsh-plugin-order-query')
  const distDir = assertSafeOutputPath(
    suiteRoot,
    options.distDir ?? path.join(suiteRoot, 'dist/customer-service-suite'),
  )

  await runPnpm(legacyRoot, ['install', '--ignore-workspace', '--frozen-lockfile'])
  await runPnpm(suiteRoot, ['install', '--frozen-lockfile'])
  await runPnpm(suiteRoot, ['run', 'verify'])
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  for (const definition of MODULES) {
    const packageDir = path.join(suiteRoot, definition.directory)
    const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
    if (manifest.name !== definition.name || manifest.version !== definition.version) {
      throw new Error(`模块元数据不匹配：${definition.directory}。`)
    }
    await runPnpm(packageDir, [
      'pack',
      '--out',
      path.join(distDir, definition.file),
    ])
  }

  const stagedManifest = await createManifestFromArtifacts(MODULES, distDir)
  const modules = []
  for (const module of stagedManifest.modules) {
    const file = contentAddressedArtifactFile(module.file, module.sha256)
    await rename(path.join(distDir, module.file), path.join(distDir, file))
    modules.push({ ...module, file })
  }
  const manifest = { ...stagedManifest, modules }
  await writeFile(
    path.join(distDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return { distDir, manifest }
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false

if (invoked) {
  const result = await packageSuite()
  console.log(`Customer service suite packaged: ${result.distDir}`)
}
