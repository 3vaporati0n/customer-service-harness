import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  MODULES,
  assertSafeOutputPath,
  buildInstallArgs,
  contentAddressedArtifactFile,
  createManifestFromArtifacts,
} from '../scripts/package-suite.mjs'
import {
  buildProfilePatchWithSqliteConfig,
  buildProfileManifestWithoutPluginBundles,
  buildProfileManifestWithArtifactSpecs,
  buildProfileWorkspaceYaml,
  installFromManifest,
  verifyDumpConfig,
} from '../scripts/install-web.mjs'

describe('package suite script', () => {
  it('locks the complete topological module order', () => {
    expect(MODULES.map((item) => item.name)).toEqual([
      '@dsh-customer-service/domain',
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
      'dsh-plugin-customer-mock-operations',
      'dsh-plugin-customer-test-data-entry',
      'dsh-bundle-customer-service-suite',
      'dsh-bundle-customer-service-demo',
    ])
  })

  it('does not ship private Harness runtime copies in customer modules', async () => {
    const manifests = await Promise.all([
      '../packages/customer-approval/package.json',
      '../packages/customer-events/package.json',
      '../packages/customer-state/package.json',
      '../packages/customer-storage-sqlite/package.json',
      '../plugins/query-order/package.json',
      '../plugins/query-logistics/package.json',
      '../plugins/query-inventory/package.json',
      '../plugins/cancel-order/package.json',
      '../plugins/return-order/package.json',
      '../plugins/refund-order/package.json',
      '../plugins/change-address/package.json',
      '../plugins/refund-progress-alert/package.json',
      '../plugins/mock-operations/package.json',
      '../plugins/test-data-entry/package.json',
    ].map(async (relative) => JSON.parse(
      await readFile(new URL(relative, import.meta.url), 'utf8'),
    )))
    const forbidden = [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-llm',
    ]
    for (const manifest of manifests) {
      const dependencies = Object.keys(manifest.dependencies ?? {})
      for (const packageName of forbidden) {
        expect(dependencies).not.toContain(packageName)
      }
    }
  })

  it('accepts only the dedicated suite output directory', () => {
    const root = '/tmp/customer-suite'
    expect(assertSafeOutputPath(root, '/tmp/customer-suite/dist/customer-service-suite'))
      .toBe('/tmp/customer-suite/dist/customer-service-suite')
    expect(() => assertSafeOutputPath(root, '/tmp/customer-suite/dist'))
      .toThrow('拒绝清理非客服套件输出目录。')
    expect(() => assertSafeOutputPath(root, '/tmp/customer-suite'))
      .toThrow('拒绝清理非客服套件输出目录。')
  })

  it('uses content-addressed tarball names to defeat stale local caches', () => {
    expect(contentAddressedArtifactFile(
      'dsh-customer-service-domain-0.1.0.tgz',
      'abcdef1234567890',
    )).toBe('dsh-customer-service-domain-0.1.0-abcdef123456.tgz')
  })

  it('builds a hashed manifest and rejects missing or duplicate artifacts', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'customer-suite-manifest-'))
    try {
      const content = Buffer.from('domain artifact')
      await writeFile(path.join(temp, 'domain-0.1.0.tgz'), content)
      const definitions = [{
        name: '@dsh-customer-service/domain',
        version: '0.1.0',
        file: 'domain-0.1.0.tgz',
        kind: 'library',
        directory: 'packages/customer-domain',
      }]
      expect(await createManifestFromArtifacts(definitions, temp)).toEqual({
        version: 1,
        modules: [{
          name: '@dsh-customer-service/domain',
          version: '0.1.0',
          file: 'domain-0.1.0.tgz',
          kind: 'library',
          sha256: createHash('sha256').update(content).digest('hex'),
        }],
      })
      await expect(createManifestFromArtifacts([
        ...definitions,
        { ...definitions[0], file: 'other.tgz' },
      ], temp)).rejects.toThrow('打包清单包含重复模块：@dsh-customer-service/domain。')
      await expect(createManifestFromArtifacts([
        { ...definitions[0], file: 'missing.tgz' },
      ], temp)).rejects.toThrow('缺少模块 tarball：missing.tgz。')
    } finally {
      await rm(temp, { recursive: true })
    }
  })

  it('installs libraries directly while keeping plugins behind the demo bundle', () => {
    const manifest = {
      version: 1,
      modules: [
        { name: '@dsh-customer-service/domain', kind: 'library', file: 'domain.tgz' },
        { name: 'dsh-plugin-customer-query-order', kind: 'plugin', file: 'order.tgz' },
        { name: 'dsh-bundle-customer-service-suite', kind: 'bundle', file: 'suite.tgz' },
        { name: 'dsh-bundle-customer-service-demo', kind: 'bundle', file: 'demo.tgz' },
      ],
    }
    expect(buildInstallArgs(manifest)).toEqual({
      dependencies: ['domain.tgz'],
      plugins: ['dsh-plugin-customer-query-order'],
      bundle: 'demo.tgz',
    })
  })
})

describe('web install script', () => {
  const dump = [
    'id: customer-sqlite-storage',
    'id: customer-state',
    'id: customer-events',
    'id: customer-approval',
    'id: customer-query-order',
    'id: customer-query-logistics',
    'id: customer-query-inventory',
    'id: customer-cancel-order',
    'id: customer-return-order',
    'id: customer-refund-order',
    'id: customer-change-address',
    'id: customer-refund-progress-alert',
    'id: customer-mock-operations',
    'id: customer-test-data-entry',
  ].join('\n')

  it('preserves unrelated Profile patches and configures SQLite exactly once', () => {
    const existing = `
- id: tools
  config:
    mode: both
- id: customer-sqlite-storage
  config:
    databasePath: /old/customer.db
- id: unrelated
  config:
    enabled: true
- id: customer-sqlite-storage
  config:
    databasePath: /duplicate/customer.db
`
    expect(parse(buildProfilePatchWithSqliteConfig(
      existing,
      '/Users/mac/Documents/ChatGPT/deepseek harness/data/customer-service.db',
    ))).toEqual([
      { id: 'tools', config: { mode: 'both' } },
      {
        id: 'customer-sqlite-storage',
        config: {
          databasePath: '/Users/mac/Documents/ChatGPT/deepseek harness/data/customer-service.db',
        },
      },
      { id: 'unrelated', config: { enabled: true } },
    ])
  })

  it('merges local tarball overrides without replacing profile settings', () => {
    const existing = `
packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
overrides:
  existing-package: 1.0.0
`
    const manifest = {
      version: 1,
      modules: [
        { name: '@dsh-customer-service/domain', kind: 'library', file: 'domain.tgz' },
        { name: 'dsh-plugin-customer-query-order', kind: 'plugin', file: 'order.tgz' },
        { name: 'dsh-bundle-customer-service-demo', kind: 'bundle', file: 'demo.tgz' },
      ],
    }
    expect(parse(buildProfileWorkspaceYaml(existing, manifest, '/tmp/customer-artifacts')))
      .toEqual({
        packages: ['.'],
        nodeLinker: 'hoisted',
        autoInstallPeers: false,
        overrides: {
          'existing-package': '1.0.0',
          '@dsh-customer-service/domain': 'file:/tmp/customer-artifacts/domain.tgz',
          'dsh-plugin-customer-query-order': 'file:/tmp/customer-artifacts/order.tgz',
        },
      })
  })

  it('removes stale standalone bundle markers without touching other profile data', () => {
    const existing = JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { 'dsh-plugin-customer-query-order': 'file:order.tgz' },
      dsh: { profile: { bundles: [
        '@deepseek-ai/dsh-base',
        'dsh-bundle-customer-service-demo',
        'dsh-plugin-customer-query-order',
      ] } },
    })
    expect(JSON.parse(buildProfileManifestWithoutPluginBundles(existing, [
      'dsh-plugin-customer-query-order',
    ])).dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      'dsh-bundle-customer-service-demo',
    ])
  })

  it('moves existing direct dependencies to current content-addressed artifacts', () => {
    const existing = JSON.stringify({
      dependencies: {
        '@dsh-customer-service/domain': 'file:/old/domain.tgz',
        'dsh-bundle-customer-service-demo': 'file:/old/demo.tgz',
        'unrelated-package': '1.0.0',
      },
    })
    const manifest = {
      modules: [
        { name: '@dsh-customer-service/domain', file: 'domain-new.tgz' },
        { name: 'dsh-bundle-customer-service-demo', file: 'demo-new.tgz' },
        { name: 'not-yet-direct', file: 'nested-new.tgz' },
      ],
    }
    expect(JSON.parse(buildProfileManifestWithArtifactSpecs(
      existing,
      manifest,
      '/tmp/customer-artifacts',
    )).dependencies).toEqual({
      '@dsh-customer-service/domain': 'file:/tmp/customer-artifacts/domain-new.tgz',
      'dsh-bundle-customer-service-demo': 'file:/tmp/customer-artifacts/demo-new.tgz',
      'unrelated-package': '1.0.0',
    })
  })

  it('installs dependencies, adds demo, removes legacy, then verifies config', async () => {
    const commands = []
    const manifest = {
      version: 1,
      modules: [
        { name: '@dsh-customer-service/domain', kind: 'library', file: 'domain.tgz' },
        { name: 'dsh-plugin-customer-query-order', kind: 'plugin', file: 'order.tgz' },
        { name: 'dsh-bundle-customer-service-demo', kind: 'bundle', file: 'demo.tgz' },
      ],
    }
    await installFromManifest(manifest, {
      distDir: '/tmp/customer-artifacts',
      profileDir: '/tmp/dsh/profiles/web',
      databasePath: '/tmp/project/data/customer-service.db',
      prepareProfile: async () => commands.push({ stage: 'configure-overrides' }),
      alignProfileArtifacts: async () => commands.push({ stage: 'align-artifact-specs' }),
      getDirectDependencies: async () => new Set(['dsh-plugin-customer-query-order']),
      pruneProfileBundles: async () => commands.push({ stage: 'prune-stale-bundles' }),
      configureSqlite: async () => commands.push({ stage: 'configure-sqlite' }),
      runner: async (command) => {
        commands.push(command)
        if (command.stage === 'remove-legacy') {
          const error = new Error('missing dependency')
          error.stderr = 'ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS'
          throw error
        }
        return command.stage === 'dump-config' ? { stdout: dump } : { stdout: '' }
      },
    })
    expect(commands.map((item) => item.stage)).toEqual([
      'configure-overrides',
      'align-artifact-specs',
      'remove-standalone-plugins',
      'prune-stale-bundles',
      'install-dependencies',
      'add-demo-bundle',
      'configure-sqlite',
      'remove-legacy',
      'dump-config',
    ])
    expect(commands[2].args).toContain('plugin')
    expect(commands[2].args).toContain('remove')
    expect(commands[2].args).toContain('dsh-plugin-customer-query-order')
    expect(commands[4].args).toContain('/tmp/customer-artifacts/domain.tgz')
    expect(commands[4].args).not.toContain('/tmp/customer-artifacts/order.tgz')
    expect(commands[4].args).toContain('--force')
    expect(commands[5].args).toContain('/tmp/customer-artifacts/demo.tgz')
    expect(commands[5].args).toContain('--force')
  })

  it('does not swallow unexpected legacy removal failures', async () => {
    const manifest = {
      version: 1,
      modules: [
        { name: '@dsh-customer-service/domain', kind: 'library', file: 'domain.tgz' },
        { name: 'dsh-bundle-customer-service-demo', kind: 'bundle', file: 'demo.tgz' },
      ],
    }
    await expect(installFromManifest(manifest, {
      distDir: '/tmp/customer-artifacts',
      profileDir: '/tmp/dsh/profiles/web',
      databasePath: '/tmp/project/data/customer-service.db',
      prepareProfile: async () => {},
      alignProfileArtifacts: async () => {},
      pruneProfileBundles: async () => {},
      configureSqlite: async () => {},
      runner: async (command) => {
        if (command.stage === 'remove-legacy') throw new Error('permission denied')
        return { stdout: dump }
      },
    })).rejects.toThrow('permission denied')
  })

  it('rejects missing or duplicate final config nodes', () => {
    expect(verifyDumpConfig(dump)).toEqual({ moduleCount: 14 })
    expect(() => verifyDumpConfig(`${dump}\nid: customer-query-order`))
      .toThrow('配置节点 customer-query-order 出现 2 次。')
    expect(() => verifyDumpConfig(dump.replace('id: customer-events', '')))
      .toThrow('配置节点 customer-events 出现 0 次。')
    expect(() => verifyDumpConfig(`${dump}\nid: order-query-tool`))
      .toThrow('最终配置仍包含 legacy dsh-plugin-order-query。')
  })
})
