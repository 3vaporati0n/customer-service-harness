# Customer Service Repository Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every customer-service module into an independently runnable local repository and push its verified `main` branch to the private GitHub repository `3vaporati0n/customer-service-harness`.

**Architecture:** Copy the current verified customer-service working tree into a clean, flat repository before removing anything from the source repository. Adapt the legacy compatibility path and database root to the new repository, migrate local SQLite data without committing it, verify the complete build/install flow, push the new repository, and only then remove the migrated material from the old DSH workspace.

**Tech Stack:** Git, GitHub CLI, Node.js 22, TypeScript 6, pnpm 11.7.0, Vitest 4, Cordis, DeepSeek Harness, SQLite via `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-08-28-customer-service-repository-extraction-design.md`

## Global Constraints

- Destination: `/Users/mac/Documents/ChatGPT/customer-service-harness`.
- Remote: private `https://github.com/3vaporati0n/customer-service-harness` with default branch `main`.
- Never commit `.DS_Store`, `node_modules`, `lib`, `dist`, tarballs, SQLite databases, WAL/SHM files, or database backups.
- Preserve refund `REFUND-5796C4B8-CF8F-44F4-A00E-89FC5386BB44`, amount `258`, status `processing`.
- Do not delete the old source or database until the destination has passed source, test, data, install, and Git checks.
- Keep the old repository's unrelated dirty `.DS_Store` untouched.
- Do not rewrite the old repository history.

---

### Task 1: Create a lossless destination snapshot

**Files:**
- Create: `/Users/mac/Documents/ChatGPT/customer-service-harness/**`
- Copy from: `examples/dsh-customer-service-suite/**`
- Copy from: `examples/dsh-plugin-order-query/**`
- Copy from: the exact plan/spec files listed in Step 3

**Interfaces:**
- Consumes: current working tree, including the uncommitted refund-progress plugin.
- Produces: destination source snapshot with `legacy/dsh-plugin-order-query` and no generated files.

- [ ] **Step 1: Assert the destination is safe to create**

```bash
test ! -e "/Users/mac/Documents/ChatGPT/customer-service-harness"
git status --short
```

Expected: destination does not exist; source status shows the refund-progress changes and `.DS_Store`.

- [ ] **Step 2: Create the destination and copy source-only files**

```bash
mkdir "/Users/mac/Documents/ChatGPT/customer-service-harness"
rsync -a \
  --exclude node_modules --exclude lib --exclude dist --exclude '*.tgz' --exclude '.DS_Store' \
  "examples/dsh-customer-service-suite/" \
  "/Users/mac/Documents/ChatGPT/customer-service-harness/"
mkdir -p "/Users/mac/Documents/ChatGPT/customer-service-harness/legacy/dsh-plugin-order-query"
rsync -a \
  --exclude node_modules --exclude lib --exclude '*.tgz' --exclude '.DS_Store' \
  "examples/dsh-plugin-order-query/" \
  "/Users/mac/Documents/ChatGPT/customer-service-harness/legacy/dsh-plugin-order-query/"
```

- [ ] **Step 3: Copy customer documentation into the destination**

```bash
mkdir -p "/Users/mac/Documents/ChatGPT/customer-service-harness/docs/plans" \
  "/Users/mac/Documents/ChatGPT/customer-service-harness/docs/specs"
cp \
  docs/superpowers/plans/2026-08-27-customer-service-platform-query.md \
  docs/superpowers/plans/2026-08-27-customer-service-sqlite-acceptance.md \
  docs/superpowers/plans/2026-08-27-order-logistics-query.md \
  docs/superpowers/plans/2026-08-27-order-query-plugin.md \
  docs/superpowers/plans/2026-08-28-customer-service-after-sales.md \
  docs/superpowers/plans/2026-08-28-customer-service-test-data-entry.md \
  docs/superpowers/plans/2026-08-28-order-inventory-linkage.md \
  docs/superpowers/plans/2026-08-28-refund-progress-alert.md \
  docs/superpowers/plans/2026-08-28-customer-service-repository-extraction.md \
  "/Users/mac/Documents/ChatGPT/customer-service-harness/docs/plans/"
cp \
  docs/superpowers/specs/2026-08-26-order-query-plugin-design.md \
  docs/superpowers/specs/2026-08-27-customer-service-sqlite-acceptance-design.md \
  docs/superpowers/specs/2026-08-27-modular-customer-service-suite-design.md \
  docs/superpowers/specs/2026-08-27-order-logistics-query-design.md \
  docs/superpowers/specs/2026-08-28-customer-service-test-data-entry-design.md \
  docs/superpowers/specs/2026-08-28-order-inventory-linkage-design.md \
  docs/superpowers/specs/2026-08-28-customer-service-repository-extraction-design.md \
  "/Users/mac/Documents/ChatGPT/customer-service-harness/docs/specs/"
cp examples/dsh-customer-service-suite/docs/module-map.md \
  "/Users/mac/Documents/ChatGPT/customer-service-harness/docs/module-map.md"
```

- [ ] **Step 4: Verify source coverage before any deletion**

```bash
test -f "/Users/mac/Documents/ChatGPT/customer-service-harness/plugins/refund-progress-alert/src/index.ts"
test -f "/Users/mac/Documents/ChatGPT/customer-service-harness/legacy/dsh-plugin-order-query/src/index.ts"
find "/Users/mac/Documents/ChatGPT/customer-service-harness" -name node_modules -o -name .DS_Store -o -name '*.db'
```

Expected: both test files exist; the final `find` prints nothing.

---

### Task 2: Make the extracted repository independently runnable

**Files:**
- Modify: `/Users/mac/Documents/ChatGPT/customer-service-harness/package.json`
- Modify: `/Users/mac/Documents/ChatGPT/customer-service-harness/scripts/package-suite.mjs`
- Modify: `/Users/mac/Documents/ChatGPT/customer-service-harness/tests/query-order-compat.test.mjs`
- Modify: `/Users/mac/Documents/ChatGPT/customer-service-harness/tests/query-logistics-compat.test.mjs`
- Modify: `/Users/mac/Documents/ChatGPT/customer-service-harness/README.md`
- Modify: `/Users/mac/Documents/ChatGPT/customer-service-harness/docs/module-map.md`
- Create: `/Users/mac/Documents/ChatGPT/customer-service-harness/tests/repository-layout.test.mjs`
- Create: `/Users/mac/Documents/ChatGPT/customer-service-harness/.gitignore`

**Interfaces:**
- Consumes: flat destination root and `legacy/dsh-plugin-order-query`.
- Produces: root-level pnpm commands and stable legacy compatibility imports.

- [ ] **Step 1: Add a failing repository-layout test**

```js
import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('standalone repository layout', () => {
  it('keeps the legacy baseline inside this repository', async () => {
    await expect(access(new URL('../legacy/dsh-plugin-order-query/src/index.ts', import.meta.url)))
      .resolves.toBeUndefined()
    const packageScript = await readFile(
      new URL('../scripts/package-suite.mjs', import.meta.url),
      'utf8',
    )
    expect(packageScript).toContain("path.join(suiteRoot, 'legacy/dsh-plugin-order-query')")
    expect(packageScript).not.toContain("'../dsh-plugin-order-query'")
  })
})
```

- [ ] **Step 2: Run the layout and compatibility tests to verify failure**

```bash
cd "/Users/mac/Documents/ChatGPT/customer-service-harness"
npx -y pnpm@11.7.0 install --lockfile-only
npx -y pnpm@11.7.0 exec vitest run tests/repository-layout.test.mjs tests/query-order-compat.test.mjs tests/query-logistics-compat.test.mjs
```

Expected: FAIL because scripts/imports still assume the old sibling layout.

- [ ] **Step 3: Update independent paths and root scripts**

Change `package-suite.mjs` to:

```js
const legacyRoot = path.resolve(suiteRoot, 'legacy/dsh-plugin-order-query')
```

Change both compatibility imports to:

```js
import { apply as applyLegacy } from '../legacy/dsh-plugin-order-query/src/index.ts'
```

Keep the existing `verify`, `package:suite`, `install:web`, `db:init`, `db:inspect`, and `db:reset` root scripts. Update `README.md` and `docs/module-map.md` so commands run from the new repository root and the active module list includes `subscribe_refund_progress_alert` and `mock_set_refund_status`.

- [ ] **Step 4: Add repository ignore rules**

```gitignore
.DS_Store
node_modules/
**/node_modules/
**/lib/
dist/
*.tgz
/data/customer-service.db
/data/customer-service.db-wal
/data/customer-service.db-shm
/data/backups/*.db
```

- [ ] **Step 5: Run focused tests to verify independent paths**

```bash
npx -y pnpm@11.7.0 exec vitest run tests/repository-layout.test.mjs tests/query-order-compat.test.mjs tests/query-logistics-compat.test.mjs
```

Expected: all focused tests pass.

---

### Task 3: Migrate and validate local SQLite acceptance data

**Files:**
- Local-only copy: `/Users/mac/Documents/ChatGPT/customer-service-harness/data/customer-service.db`
- Local-only copy: `/Users/mac/Documents/ChatGPT/customer-service-harness/data/backups/`

**Interfaces:**
- Consumes: old repository SQLite database after the Harness process is stopped.
- Produces: readable destination database with the existing refund state.

- [ ] **Step 1: Stop the exact Harness process and checkpoint SQLite**

Stop only the process listening on TCP `3080`. Then run:

```bash
node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('data/customer-service.db'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();"
```

- [ ] **Step 2: Copy database files and backups without deleting the source**

```bash
mkdir -p "/Users/mac/Documents/ChatGPT/customer-service-harness/data/backups"
rsync -a "data/" "/Users/mac/Documents/ChatGPT/customer-service-harness/data/"
```

- [ ] **Step 3: Verify the preserved refund in read-only mode**

```bash
cd "/Users/mac/Documents/ChatGPT/customer-service-harness"
node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('data/customer-service.db',{readOnly:true}); const row=db.prepare('SELECT refund_id, amount, status, version FROM refunds WHERE refund_id=?').get('REFUND-5796C4B8-CF8F-44F4-A00E-89FC5386BB44'); console.log(JSON.stringify(row)); db.close();"
```

Expected: amount `258`, status `processing`, version `2`.

- [ ] **Step 4: Verify Git ignores every local database artifact**

```bash
git init -b main
git status --short --ignored data
```

Expected: `data/README.md` is visible; database and backups are ignored.

---

### Task 4: Run full standalone verification and reinstall Harness

**Files:**
- Modify mechanically: `/Users/mac/Documents/ChatGPT/customer-service-harness/pnpm-lock.yaml`
- External profile update: `/Users/mac/.dsh/profiles/web/**`

**Interfaces:**
- Consumes: independent source and destination SQLite database.
- Produces: verified artifacts and Web Profile pointing to the new database.

- [ ] **Step 1: Install from the standalone lockfile**

```bash
cd "/Users/mac/Documents/ChatGPT/customer-service-harness"
npx -y pnpm@11.7.0 install --lockfile-only
npx -y pnpm@11.7.0 install --frozen-lockfile
```

- [ ] **Step 2: Run full verification**

```bash
npx -y pnpm@11.7.0 run verify
```

Expected: TypeScript builds, all package/root tests pass, production Bundle has 12 nodes, demo Bundle has 14 nodes.

- [ ] **Step 3: Package and install the demo Bundle**

```bash
npx -y pnpm@11.7.0 run install:web
```

Expected: installation succeeds in `/Users/mac/.dsh/profiles/web`.

- [ ] **Step 4: Verify Profile and database paths**

```bash
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile web --dump-config
```

Expected: exactly one `customer-refund-progress-alert`; SQLite path is `/Users/mac/Documents/ChatGPT/customer-service-harness/data/customer-service.db`; legacy `order-query-tool` is absent.

---

### Task 5: Commit and push the private GitHub repository

**Files:**
- Create: destination Git history and `origin` configuration.

**Interfaces:**
- Consumes: verified standalone repository.
- Produces: private GitHub repository whose `main` matches local `HEAD`.

- [ ] **Step 1: Inspect the complete staged boundary**

```bash
git add .
git status --short
git diff --cached --check
git diff --cached --name-only | rg '(^|/)(node_modules|lib|dist|\.DS_Store)(/|$)|\.db($|-)|\.tgz$' && exit 1 || true
```

Expected: source/docs only; forbidden scan has no matches.

- [ ] **Step 2: Create the initial commit**

```bash
git commit -m "feat: publish modular customer service harness"
```

- [ ] **Step 3: Create and push the private GitHub repository**

```bash
gh repo create 3vaporati0n/customer-service-harness \
  --private --source=. --remote=origin --push --description "Modular customer-service tools and bundles for DeepSeek Harness"
```

- [ ] **Step 4: Verify the remote**

```bash
gh repo view 3vaporati0n/customer-service-harness --json isPrivate,defaultBranchRef,url
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/main | cut -f1)"
```

Expected: private is true, default branch is `main`, hashes match.

---

### Task 6: Remove migrated customer material from the old DSH workspace

**Files:**
- Delete: `examples/dsh-customer-service-suite/`
- Delete: `examples/dsh-plugin-order-query/`
- Delete: old customer-service plans/specs after destination comparison
- Delete: `data/README.md` and local old database after destination validation
- Delete: root `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: verified/pushed destination repository.
- Produces: old `deepseek harness` working tree containing only DSH learning material and non-customer examples.

- [ ] **Step 1: Compare the source and destination manifests**

Build sorted source file lists excluding generated/data artifacts and compare them to destination equivalents. Stop on any missing destination file.

- [ ] **Step 2: Remove tracked customer material with Git**

```bash
git rm -r \
  examples/dsh-customer-service-suite \
  examples/dsh-plugin-order-query \
  data/README.md \
  package.json \
  docs/superpowers/plans/2026-08-27-customer-service-platform-query.md \
  docs/superpowers/plans/2026-08-27-customer-service-sqlite-acceptance.md \
  docs/superpowers/plans/2026-08-27-order-logistics-query.md \
  docs/superpowers/plans/2026-08-27-order-query-plugin.md \
  docs/superpowers/plans/2026-08-28-customer-service-after-sales.md \
  docs/superpowers/plans/2026-08-28-customer-service-test-data-entry.md \
  docs/superpowers/plans/2026-08-28-order-inventory-linkage.md \
  docs/superpowers/plans/2026-08-28-refund-progress-alert.md \
  docs/superpowers/plans/2026-08-28-customer-service-repository-extraction.md \
  docs/superpowers/specs/2026-08-26-order-query-plugin-design.md \
  docs/superpowers/specs/2026-08-27-customer-service-sqlite-acceptance-design.md \
  docs/superpowers/specs/2026-08-27-modular-customer-service-suite-design.md \
  docs/superpowers/specs/2026-08-27-order-logistics-query-design.md \
  docs/superpowers/specs/2026-08-28-customer-service-test-data-entry-design.md \
  docs/superpowers/specs/2026-08-28-order-inventory-linkage-design.md \
  docs/superpowers/specs/2026-08-28-customer-service-repository-extraction-design.md
```

Update `.gitignore` to contain exactly the remaining DSH-specific rules:

```gitignore
.worktrees/
.research/
examples/dsh-plugin-beginner-greet/node_modules/
examples/dsh-plugin-beginner-greet/lib/
examples/dsh-plugin-beginner-greet/*.tgz
```

- [ ] **Step 3: Move remaining untracked old data/build directories to Trash**

After confirming destination data, move the exact old `data/` and any generated remnants under the two migrated example directories into a timestamped folder under `/Users/mac/.Trash/`. Do not touch the repository-root `.DS_Store`.

- [ ] **Step 4: Verify the old repository boundary**

```bash
test ! -e "examples/dsh-customer-service-suite"
test ! -e "examples/dsh-plugin-order-query"
test ! -e "data"
git status --short
git diff --check
```

Expected: only intentional tracked removals/ignore update plus the pre-existing untracked `.DS_Store`.

- [ ] **Step 5: Commit old repository cleanup**

```bash
git add .gitignore
git commit -m "refactor: extract customer service into standalone repository"
```

- [ ] **Step 6: Final cross-repository verification**

```bash
git -C "/Users/mac/Documents/ChatGPT/customer-service-harness" status --short
git -C "/Users/mac/Documents/ChatGPT/customer-service-harness" remote -v
git status --short
```

Expected: destination clean and pushed; old repository clean except `.DS_Store`; old database recoverable from Trash and current database active at the new location.
