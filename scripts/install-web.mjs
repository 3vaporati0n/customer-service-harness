import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { parse, stringify } from 'yaml'

import { buildInstallArgs, packageSuite } from './package-suite.mjs'
import {
  resolveAcceptanceDatabasePath,
  resolveMainCheckoutRoot,
} from './project-paths.mjs'

const execFileAsync = promisify(execFile)
const REQUIRED_CONFIG_IDS = [
  'customer-sqlite-storage',
  'customer-state',
  'customer-events',
  'customer-approval',
  'customer-query-order',
  'customer-query-logistics',
  'customer-query-inventory',
  'customer-cancel-order',
  'customer-return-order',
  'customer-refund-order',
  'customer-change-address',
  'customer-refund-progress-alert',
  'customer-mock-operations',
  'customer-test-data-entry',
]

export function buildProfilePatchWithSqliteConfig(existing, databasePath) {
  const document = existing.trim() ? parse(existing) : []
  if (!Array.isArray(document)) throw new Error('Web Profile Patch 必须是 YAML 数组。')
  let configured = false
  const entries = []
  for (const entry of document) {
    if (entry?.id !== 'customer-sqlite-storage') {
      entries.push(entry)
      continue
    }
    if (configured) continue
    configured = true
    entries.push({
      ...entry,
      id: 'customer-sqlite-storage',
      config: {
        ...(entry?.config ?? {}),
        databasePath,
      },
    })
  }
  if (!configured) {
    entries.push({
      id: 'customer-sqlite-storage',
      config: { databasePath },
    })
  }
  return stringify(entries)
}

async function configureProfileSqlite(profileDir, databasePath) {
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  let existing = ''
  try {
    existing = await readFile(patchFile, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await writeFile(
    patchFile,
    buildProfilePatchWithSqliteConfig(existing, databasePath),
  )
}

function dshArgs(...args) {
  return [
    '-y',
    'pnpm@11.7.0',
    '--package=@deepseek-ai/dsh',
    'dlx',
    'dsh',
    ...args,
  ]
}

export function buildProfileWorkspaceYaml(existing, manifest, distDir) {
  const document = existing.trim() ? parse(existing) : {}
  const overrides = { ...(document.overrides ?? {}) }
  for (const module of manifest.modules) {
    if (module.kind === 'bundle') continue
    overrides[module.name] = `file:${path.resolve(distDir, module.file)}`
  }
  return stringify({
    ...document,
    packages: document.packages ?? ['.'],
    overrides,
  })
}

export function buildProfileManifestWithoutPluginBundles(existing, pluginNames) {
  const manifest = JSON.parse(existing)
  const removed = new Set(pluginNames)
  const bundles = manifest.dsh?.profile?.bundles
  if (Array.isArray(bundles)) {
    manifest.dsh.profile.bundles = bundles.filter((name) => !removed.has(name))
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function buildProfileManifestWithArtifactSpecs(existing, manifest, distDir) {
  const profile = JSON.parse(existing)
  const dependencies = { ...(profile.dependencies ?? {}) }
  for (const module of manifest.modules) {
    if (Object.hasOwn(dependencies, module.name)) {
      dependencies[module.name] = `file:${path.resolve(distDir, module.file)}`
    }
  }
  return `${JSON.stringify({ ...profile, dependencies }, null, 2)}\n`
}

async function prepareProfileOverrides(profileDir, manifest, distDir) {
  await mkdir(profileDir, { recursive: true })
  const workspaceFile = path.join(profileDir, 'pnpm-workspace.yaml')
  let existing = ''
  try {
    existing = await readFile(workspaceFile, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await writeFile(
    workspaceFile,
    buildProfileWorkspaceYaml(existing, manifest, distDir),
  )
}

async function readDirectDependencies(profileDir) {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(profileDir, 'package.json'), 'utf8'),
    )
    return new Set(Object.keys(manifest.dependencies ?? {}))
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set()
    throw error
  }
}

async function alignProfileArtifactSpecs(profileDir, manifest, distDir) {
  const manifestFile = path.join(profileDir, 'package.json')
  let existing
  try {
    existing = await readFile(manifestFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  await writeFile(
    manifestFile,
    buildProfileManifestWithArtifactSpecs(existing, manifest, distDir),
  )
}

async function pruneProfilePluginBundles(profileDir, pluginNames) {
  const manifestFile = path.join(profileDir, 'package.json')
  let existing
  try {
    existing = await readFile(manifestFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  await writeFile(
    manifestFile,
    buildProfileManifestWithoutPluginBundles(existing, pluginNames),
  )
}

export function verifyDumpConfig(output) {
  for (const id of REQUIRED_CONFIG_IDS) {
    const count = output.split(`id: ${id}`).length - 1
    if (count !== 1) throw new Error(`配置节点 ${id} 出现 ${count} 次。`)
  }
  if (output.includes('dsh-plugin-order-query') || output.includes('id: order-query-tool')) {
    throw new Error('最终配置仍包含 legacy dsh-plugin-order-query。')
  }
  return { moduleCount: REQUIRED_CONFIG_IDS.length }
}

function isMissingLegacyError(error) {
  const details = `${error?.message ?? ''}\n${error?.stdout ?? ''}\n${error?.stderr ?? ''}`
  return /ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS|not a dependency|not found/i.test(details)
}

async function defaultRunner(command) {
  return execFileAsync(command.executable, command.args, {
    cwd: command.cwd,
    maxBuffer: 20 * 1024 * 1024,
  })
}

export async function installFromManifest(manifest, options) {
  const { dependencies, plugins, bundle } = buildInstallArgs(manifest)
  const runner = options.runner ?? defaultRunner
  const resolveArtifact = (file) => path.resolve(options.distDir, file)

  await (options.prepareProfile ?? prepareProfileOverrides)(
    options.profileDir,
    manifest,
    options.distDir,
  )
  await (options.alignProfileArtifacts ?? alignProfileArtifactSpecs)(
    options.profileDir,
    manifest,
    options.distDir,
  )

  const directDependencies = await (
    options.getDirectDependencies ?? readDirectDependencies
  )(options.profileDir)
  const standalonePlugins = plugins.filter((name) => directDependencies.has(name))
  if (standalonePlugins.length > 0) {
    await runner({
      stage: 'remove-standalone-plugins',
      executable: 'npx',
      args: dshArgs(
        'plugin',
        '--profile',
        'web',
        'remove',
        ...standalonePlugins,
      ),
      cwd: options.profileDir,
    })
  }
  await (options.pruneProfileBundles ?? pruneProfilePluginBundles)(
    options.profileDir,
    plugins,
  )

  await runner({
    stage: 'install-dependencies',
    executable: 'npx',
    args: [
      '-y',
      'pnpm@11.7.0',
      '--dir',
      options.profileDir,
      'add',
      '--force',
      ...dependencies.map(resolveArtifact),
    ],
    cwd: options.profileDir,
  })
  await runner({
    stage: 'add-demo-bundle',
    executable: 'npx',
    args: dshArgs(
      'plugin',
      '--profile',
      'web',
      'add',
      '--force',
      resolveArtifact(bundle),
    ),
    cwd: options.profileDir,
  })
  await (options.configureSqlite ?? configureProfileSqlite)(
    options.profileDir,
    options.databasePath,
  )
  try {
    await runner({
      stage: 'remove-legacy',
      executable: 'npx',
      args: dshArgs('plugin', '--profile', 'web', 'remove', 'dsh-plugin-order-query'),
      cwd: options.profileDir,
    })
  } catch (error) {
    if (!isMissingLegacyError(error)) throw error
  }
  const dumped = await runner({
    stage: 'dump-config',
    executable: 'npx',
    args: dshArgs('--profile', 'web', '--dump-config'),
    cwd: options.profileDir,
  })
  return verifyDumpConfig(dumped.stdout)
}

export async function installWeb(options = {}) {
  const suiteRoot = path.resolve(
    options.suiteRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  )
  const packaged = await (options.packageSuite ?? packageSuite)({
    ...options,
    suiteRoot,
  })
  const projectRoot = path.resolve(
    options.projectRoot ?? resolveMainCheckoutRoot(suiteRoot),
  )
  const databasePath = resolveAcceptanceDatabasePath(projectRoot)
  await (options.initializeDatabase ?? (async () => {
    await execFileAsync('node', [path.join(suiteRoot, 'scripts/customer-db.mjs'), 'init'], {
      cwd: suiteRoot,
      maxBuffer: 20 * 1024 * 1024,
    })
  }))({ databasePath, projectRoot, suiteRoot })
  const dshHome = path.resolve(options.dshHome ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'))
  const profileDir = path.join(dshHome, 'profiles/web')
  const verification = await installFromManifest(packaged.manifest, {
    distDir: packaged.distDir,
    profileDir,
    databasePath,
    runner: options.runner,
  })
  return { ...packaged, profileDir, verification }
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false

if (invoked) {
  const result = await installWeb()
  console.log(`Customer service demo installed in ${result.profileDir}`)
}
