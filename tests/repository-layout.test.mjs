import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('standalone repository layout', () => {
  it('keeps the legacy baseline inside this repository', async () => {
    await expect(access(
      new URL('../legacy/dsh-plugin-order-query/src/index.ts', import.meta.url),
    )).resolves.toBeUndefined()
    const packageScript = await readFile(
      new URL('../scripts/package-suite.mjs', import.meta.url),
      'utf8',
    )
    expect(packageScript).toContain(
      "path.join(suiteRoot, 'legacy/dsh-plugin-order-query')",
    )
    expect(packageScript).not.toContain("'../dsh-plugin-order-query'")
    expect(packageScript).toContain("['install', '--ignore-workspace', '--frozen-lockfile']")
    const manifest = JSON.parse(await readFile(
      new URL('../package.json', import.meta.url),
      'utf8',
    ))
    expect(manifest.scripts['legacy:install']).toContain('--ignore-workspace')
  })

  it('uses standalone compatibility imports', async () => {
    for (const file of ['query-order-compat.test.mjs', 'query-logistics-compat.test.mjs']) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8')
      expect(source).toContain("'../legacy/dsh-plugin-order-query/src/index.ts'")
      expect(source).not.toContain("'../../dsh-plugin-order-query/src/index.ts'")
    }
  })
})
