# Customer Service SQLite Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-local SQLite acceptance database that persists all five customer-state entity types across Harness restarts without changing existing tool interfaces.

**Architecture:** Add a storage contract to the domain package, keep an in-memory implementation for unit tests, and add a standalone `@dsh-customer-service/storage-sqlite` Cordis service backed by Node's built-in `node:sqlite`. `customerState` retains business validation, versioning, queues, and event creation while delegating committed reads and writes to the injected storage service. Installation initializes the project database non-destructively and writes its absolute path into the Web Profile patch.

**Tech Stack:** TypeScript 6.0.3, Node.js `node:sqlite` on Node `^22.19.0 || >=24.0.0`, Cordis 4.0.1, pnpm 11.7.0, Vitest 4.1.8, YAML 2.8.1.

**Spec:** `docs/superpowers/specs/2026-08-27-customer-service-sqlite-acceptance-design.md`

## Global Constraints

- The database is acceptance-only and must be `/Users/mac/Documents/ChatGPT/deepseek harness/data/customer-service.db` for the current project checkout.
- Commands executed from a linked Git worktree must resolve the main checkout through `git rev-parse --path-format=absolute --git-common-dir`; they must never create the acceptance database inside `.worktrees/`.
- Do not require a system SQLite installation or a database server.
- Use only Node's built-in `node:sqlite`; do not add `better-sqlite3`, `sqlite3`, or a WASM database.
- Persist orders, logistics, inventories, return requests, and refunds; keep alerts, delivery records, approvals, and audits in memory.
- Existing `query_order`, `query_logistics`, and `query_inventory` schemas and Chinese rendering must not change.
- `customer-service:install:web` must initialize or migrate but never reset existing data.
- `customer-service:db:reset` must create a recoverable backup before replacing acceptance data.
- Automated tests must use temporary database paths and must never open the project acceptance database.
- Database files, WAL/SHM files, and backups must remain untracked.
- Preserve unrelated user files, including the existing untracked `.DS_Store`.

---

### Task 1: Extract the customer storage contract and memory adapter

**Files:**
- Modify: `examples/dsh-customer-service-suite/packages/customer-domain/src/index.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-state/src/memory-storage.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/tests/state.test.mjs`

**Interfaces:**
- Produces `CustomerStorage`, consumed by both `CustomerStateService` and the SQLite package.
- Produces `MemoryCustomerStorage`, used as the direct-construction default in unit tests.
- Keeps all public `CustomerStateService` read/create/update method signatures unchanged.

- [ ] **Step 1: Write the failing injected-storage test**

Add a focused test proving `CustomerStateService` reads and commits through a supplied storage object rather than private maps:

```js
it('uses the injected storage for reads and committed updates', async () => {
  const storage = new MemoryCustomerStorage(createSeedState())
  const state = createState({ storage })
  await state.updateInventory('SKU-1002', () => ({ stock: 7 }))

  expect(storage.getInventory('SKU-1002')).toMatchObject({ stock: 7, version: 2 })
  expect(state.getInventory('SKU-1002')).toMatchObject({ stock: 7, version: 2 })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/state test
```

Expected: FAIL because `MemoryCustomerStorage` and the `storage` option do not exist.

- [ ] **Step 3: Add the storage contract**

Export this contract from the domain package:

```ts
export interface CustomerStorage {
  transaction<T>(operation: () => T): T
  getOrder(id: string): Order | undefined
  getLogistics(id: string): Logistics | undefined
  getInventory(id: string): Inventory | undefined
  getReturn(id: string): ReturnRequest | undefined
  getRefund(id: string): Refund | undefined
  findReturnByOrder(orderId: string): ReturnRequest | undefined
  findRefundByOrder(orderId: string): Refund | undefined
  insertReturn(record: ReturnRequest): void
  insertRefund(record: Refund): void
  replaceOrder(record: Order, expectedVersion: number): void
  replaceLogistics(record: Logistics, expectedVersion: number): void
  replaceInventory(record: Inventory, expectedVersion: number): void
  replaceReturn(record: ReturnRequest, expectedVersion: number): void
  replaceRefund(record: Refund, expectedVersion: number): void
  close(): void
}

export class StorageVersionConflictError extends Error {
  constructor(id: string, expectedVersion: number) {
    super(`业务实体 ${id} 的存储版本不是 ${expectedVersion}。`)
    this.name = 'StorageVersionConflictError'
  }
}

export class CustomerStorageCorruptionError extends Error {
  constructor(column: string) {
    super(`客服数据库字段 ${column} 的内容已损坏。`)
    this.name = 'CustomerStorageCorruptionError'
  }
}
```

- [ ] **Step 4: Implement the memory adapter**

Move map ownership out of `CustomerStateService` into `MemoryCustomerStorage`. Clone values on ingress/egress, throw `EntityAlreadyExistsError` on duplicate inserts, and require every replacement to match `expectedVersion` before writing the next version. `transaction()` executes the callback synchronously and `close()` is a no-op.

- [ ] **Step 5: Delegate state reads and commits to storage**

Extend options and constructor behavior:

```ts
export interface CustomerStateOptions {
  clock?: Clock
  idFactory?: () => string
  storage?: CustomerStorage
}

this.#storage = options.storage ?? new MemoryCustomerStorage(createSeedState())
```

Wrap each create/update read-and-write sequence in `storage.transaction()`. Compute and validate the new entity in `customerState`, then call the matching `insert*` or `replace*` method. Generate the event only after the transaction returns successfully.

- [ ] **Step 6: Run state and regression tests and verify GREEN**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/state test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite test
```

Expected: existing state behavior and all suite tests pass without SQLite.

- [ ] **Step 7: Commit Task 1**

```bash
git add examples/dsh-customer-service-suite/packages/customer-domain/src/index.ts examples/dsh-customer-service-suite/packages/customer-state/src/index.ts examples/dsh-customer-service-suite/packages/customer-state/src/memory-storage.ts examples/dsh-customer-service-suite/packages/customer-state/tests/state.test.mjs
git commit -m "refactor: extract customer state storage contract"
```

---

### Task 2: Build the SQLite schema, codecs, and durable storage

**Files:**
- Create: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/package.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/src/schema.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/src/codecs.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/src/storage.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/src/index.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/tests/storage.test.mjs`
- Modify: `examples/dsh-customer-service-suite/package.json`
- Modify: `examples/dsh-customer-service-suite/pnpm-lock.yaml`

**Interfaces:**
- Consumes `CustomerStorage`, entity types, `createSeedState`, and domain errors.
- Produces `SqliteCustomerStorage`, `initializeCustomerDatabase`, `inspectCustomerDatabase`, and `resetCustomerDatabase`.
- Uses `@types/node` version `22.20.1` only as a development dependency; runtime uses `node:sqlite`.

- [ ] **Step 1: Scaffold package metadata and write failing initialization tests**

Create package metadata with `name: "@dsh-customer-service/storage-sqlite"`, version `0.1.0`, `files: ["lib"]`, Node engine `^22.19.0 || >=24.0.0`, runtime dependency only on `@dsh-customer-service/domain`, and dev dependencies `@deepseek-ai/cordis: 4.0.1`, `@types/node: 22.20.1`, and Vitest via the workspace.

Write tests using `mkdtemp()` and an explicit temporary `databasePath`:

```js
it('creates schema and seeds a new database exactly once', () => {
  const first = new SqliteCustomerStorage(databasePath)
  expect(first.getInventory('SKU-1002')).toMatchObject({ stock: 0, version: 1 })
  first.replaceInventory({ ...first.getInventory('SKU-1002'), stock: 5, version: 2 }, 1)
  first.close()

  const reopened = new SqliteCustomerStorage(databasePath)
  expect(reopened.getInventory('SKU-1002')).toMatchObject({ stock: 5, version: 2 })
  reopened.close()
})
```

- [ ] **Step 2: Run the storage test and verify RED**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite install
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/storage-sqlite test
```

Expected: FAIL because the SQLite implementation exports do not exist.

- [ ] **Step 3: Implement migration version 1**

`schema.ts` must export `SCHEMA_VERSION = 1` and `migrateDatabase(db)`. Configure every connection with:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Create the six tables specified by the design, including `CHECK (stock >= 0)`, `CHECK (amount >= 0)`, order foreign keys, and indexes for `return_requests(order_id)` and `refunds(order_id)`. Use `PRAGMA user_version = 1` only after the migration transaction succeeds.

- [ ] **Step 4: Implement strict row codecs**

`codecs.ts` must contain focused functions such as:

```ts
export function decodeOrder(row: Record<string, unknown>): Order
export function decodeLogistics(row: Record<string, unknown>): Logistics
export function encodeJson(value: unknown): string
export function decodeJson<T>(column: string, value: unknown): T
```

Reject non-string JSON columns and malformed JSON with `CustomerStorageCorruptionError`, naming the bad column without printing full customer data.

- [ ] **Step 5: Implement all five entity operations**

`SqliteCustomerStorage` opens an absolute database path, creates its parent directory, migrates, and seeds only when `customer_meta.seed_version` is absent. Use prepared statements for every read and write. Replacement SQL must use both ID and old version:

```sql
UPDATE inventories
SET product_name = ?, stock = ?, updated_at = ?, version = ?
WHERE sku = ? AND version = ?
```

If `changes !== 1`, throw `StorageVersionConflictError`. Implement `transaction()` with nested-call protection so a state create/update is atomic. `close()` must be idempotent.

- [ ] **Step 6: Add failure and boundary tests**

Add real-database tests for:

- all five entity types;
- duplicate return/refund inserts;
- stale version rejection;
- negative inventory/refund constraints;
- transaction rollback after an intentional throw;
- malformed `items_json` and `events_json` producing `CustomerStorageCorruptionError`;
- detached nested objects after reads.

- [ ] **Step 7: Run focused tests and build**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/storage-sqlite test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/storage-sqlite build
```

Expected: all SQLite tests pass and TypeScript emits `lib/` without errors.

- [ ] **Step 8: Commit Task 2**

```bash
git add examples/dsh-customer-service-suite/packages/customer-storage-sqlite examples/dsh-customer-service-suite/package.json examples/dsh-customer-service-suite/pnpm-lock.yaml
git commit -m "feat: add sqlite customer storage"
```

---

### Task 3: Inject SQLite storage into customerState and verify restart persistence

**Files:**
- Modify: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/tests/storage.test.mjs`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/tests/state.test.mjs`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/package.json`

**Interfaces:**
- SQLite plugin provides `ctx.customerStorage`.
- State plugin injects `customerStorage` and provides the unchanged `ctx.customerState` API.
- Direct `new CustomerStateService()` continues using `MemoryCustomerStorage` for existing tests.

- [ ] **Step 1: Write failing service-injection and restart tests**

Test the Cordis-facing functions without mocking database behavior:

```js
it('persists a customerState update after storage is closed and reopened', async () => {
  const firstStorage = new SqliteCustomerStorage(databasePath)
  const firstState = createState({ storage: firstStorage })
  await firstState.updateInventory('SKU-1002', () => ({ stock: 5 }))
  firstStorage.close()

  const secondStorage = new SqliteCustomerStorage(databasePath)
  const secondState = createState({ storage: secondStorage })
  expect(secondState.getInventory('SKU-1002')).toMatchObject({ stock: 5, version: 2 })
  secondStorage.close()
})
```

Also assert `state.inject` equals `['customerStorage']` and the SQLite plugin returns an idempotent disposer.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/state test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/storage-sqlite test
```

Expected: FAIL because Cordis injection is not wired.

- [ ] **Step 3: Provide `customerStorage` from the SQLite plugin**

Declare the Context service and config:

```ts
export interface SqliteStorageConfig {
  databasePath: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    customerStorage: CustomerStorage
  }
}

export const name = 'customer-sqlite-storage'
export default function apply(ctx: Context, config: SqliteStorageConfig) {
  const storage = new SqliteCustomerStorage(config.databasePath)
  ctx.reflect.provide('customerStorage', storage)
  return () => storage.close()
}
```

Reject a missing, relative, or non-`.db` path before opening a file.

- [ ] **Step 4: Inject the storage into the state plugin**

Export `inject = ['customerStorage'] as const`. The default state `apply()` must pass `ctx.customerStorage`; direct constructor calls keep the memory default. Do not add SQLite as a runtime dependency of the state package.

- [ ] **Step 5: Verify persistence and regressions**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/state test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/storage-sqlite test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite test
```

Expected: restart persistence passes and all prior query/event/approval/mock tests remain green.

- [ ] **Step 6: Commit Task 3**

```bash
git add examples/dsh-customer-service-suite/packages/customer-storage-sqlite examples/dsh-customer-service-suite/packages/customer-state
git commit -m "feat: persist customer state through sqlite"
```

---

### Task 4: Add safe init, inspect, and reset commands

**Files:**
- Create: `examples/dsh-customer-service-suite/scripts/customer-db.mjs`
- Create: `examples/dsh-customer-service-suite/tests/customer-db.test.mjs`
- Modify: `examples/dsh-customer-service-suite/package.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `data/README.md`

**Interfaces:**
- Produces `resolveMainCheckoutRoot(cwd)`, `resolveAcceptanceDatabasePath(projectRoot)`, `runDbCommand(command, options)`, and three root pnpm commands.
- Consumes the compiled SQLite package API.

- [ ] **Step 1: Write failing command tests**

Use temporary project roots and assert:

```js
it('inspect reports schema and all five counts', async () => {
  await runDbCommand('init', { projectRoot })
  const report = await runDbCommand('inspect', { projectRoot })
  expect(report).toMatchObject({
    schemaVersion: 1,
    seedVersion: 1,
    counts: { orders: 3, logistics: 3, inventories: 2, returns: 0, refunds: 0 },
  })
})
```

Add a reset test that mutates inventory, runs reset, confirms stock 0, and confirms exactly one timestamped backup exists under `data/backups/`.

- [ ] **Step 2: Run command tests and verify RED**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/customer-db.test.mjs
```

Expected: FAIL because `customer-db.mjs` is missing.

- [ ] **Step 3: Implement commands with a guarded project path**

Resolve the main checkout by running `git rev-parse --path-format=absolute --git-common-dir` from the caller's current directory and taking the parent directory of the returned `.git` path. Resolve only `<mainCheckoutRoot>/data/customer-service.db`; reject any result inside `.worktrees/`. Tests pass an explicit temporary `projectRoot` and do not invoke Git. `init` calls `initializeCustomerDatabase`; `inspect` returns and prints a JSON-safe report; `reset` creates `data/backups/customer-service-YYYYMMDD-HHMMSS.db` with SQLite `VACUUM INTO`, then resets all five business tables and seed metadata in one transaction.

Export functions for tests and execute CLI behavior only when `import.meta.url` matches `process.argv[1]`.

- [ ] **Step 4: Add scripts and ignore rules**

Suite scripts:

```json
"db:build": "pnpm --filter @dsh-customer-service/storage-sqlite build",
"db:init": "pnpm db:build && node scripts/customer-db.mjs init",
"db:inspect": "pnpm db:build && node scripts/customer-db.mjs inspect",
"db:reset": "pnpm db:build && node scripts/customer-db.mjs reset"
```

Root scripts delegate with `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite run ...`. Add the four database and backup patterns from the design to `.gitignore`; `data/README.md` explains that generated databases are local acceptance artifacts.

- [ ] **Step 5: Run focused tests and a real temporary CLI check**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/customer-db.test.mjs
npx -y pnpm@11.7.0 run customer-service:db:init
npx -y pnpm@11.7.0 run customer-service:db:inspect
```

Expected real inspection: schema 1, seed 1, counts `3/3/2/0/0`; generated files remain ignored.

- [ ] **Step 6: Commit Task 4**

```bash
git add .gitignore package.json data/README.md examples/dsh-customer-service-suite/package.json examples/dsh-customer-service-suite/scripts/customer-db.mjs examples/dsh-customer-service-suite/tests/customer-db.test.mjs
git commit -m "feat: add customer database lifecycle commands"
```

---

### Task 5: Package, bundle, and install the SQLite module

**Files:**
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-suite/cordis.patch.yml`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-suite/package.json`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-demo/cordis.patch.yml`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-demo/package.json`
- Modify: `examples/dsh-customer-service-suite/scripts/package-suite.mjs`
- Modify: `examples/dsh-customer-service-suite/scripts/install-web.mjs`
- Modify: `examples/dsh-customer-service-suite/scripts/verify-bundles.mjs`
- Modify: `examples/dsh-customer-service-suite/tests/bundle.test.mjs`
- Modify: `examples/dsh-customer-service-suite/tests/package-scripts.test.mjs`

**Interfaces:**
- Adds config node ID `customer-sqlite-storage` before `customer-state`.
- Adds the SQLite library tarball to the content-addressed manifest and Profile overrides.
- Produces `buildProfilePatchWithSqliteConfig(existingYaml, databasePath)`.

- [ ] **Step 1: Update tests first for module order and Profile patch preservation**

Require module order:

```js
[
  '@dsh-customer-service/domain',
  '@dsh-customer-service/storage-sqlite',
  '@dsh-customer-service/state',
  '@dsh-customer-service/events',
  '@dsh-customer-service/approval',
  'dsh-plugin-customer-query-order',
  'dsh-plugin-customer-query-logistics',
  'dsh-plugin-customer-query-inventory',
  'dsh-plugin-customer-mock-operations',
  'dsh-bundle-customer-service-suite',
  'dsh-bundle-customer-service-demo',
]
```

Add a Profile patch test beginning with the existing `tools.mode = both` entry and assert it is preserved while one `customer-sqlite-storage` config entry is inserted or updated with the exact absolute database path.

- [ ] **Step 2: Run package and Bundle tests and verify RED**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/bundle.test.mjs tests/package-scripts.test.mjs
```

Expected: FAIL because the storage module and Profile configuration are absent.

- [ ] **Step 3: Add SQLite to both Bundles and package manifest**

Insert this first in each Bundle:

```yaml
- id: customer-sqlite-storage
  name: '@dsh-customer-service/storage-sqlite'
```

Add the workspace dependency to both Bundle manifests and add the storage library immediately after the domain package in `MODULES`.

- [ ] **Step 4: Merge the Profile database config without data loss**

Implement `buildProfilePatchWithSqliteConfig()` using YAML parse/stringify. Preserve every unrelated entry. Replace duplicate storage config entries with exactly one:

```yaml
- id: customer-sqlite-storage
  config:
    databasePath: /Users/mac/Documents/ChatGPT/deepseek harness/data/customer-service.db
```

During `installWeb()`, initialize the project database before package installation. During `installFromManifest()`, write the Profile patch after adding the demo Bundle and before `--dump-config`. Add `customer-sqlite-storage` to `REQUIRED_CONFIG_IDS`; expected installed node count becomes 8.

- [ ] **Step 5: Verify Bundle counts and install command ordering**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/bundle.test.mjs tests/package-scripts.test.mjs
node examples/dsh-customer-service-suite/scripts/verify-bundles.mjs
```

Expected: production Bundle 7, demo Bundle 8, Profile patch preserved, SQLite node present exactly once.

- [ ] **Step 6: Commit Task 5**

```bash
git add examples/dsh-customer-service-suite/bundles examples/dsh-customer-service-suite/scripts/package-suite.mjs examples/dsh-customer-service-suite/scripts/install-web.mjs examples/dsh-customer-service-suite/scripts/verify-bundles.mjs examples/dsh-customer-service-suite/tests/bundle.test.mjs examples/dsh-customer-service-suite/tests/package-scripts.test.mjs
git commit -m "feat: install sqlite customer storage bundle"
```

---

### Task 6: Document, fully verify, and run the persistence acceptance scenario

**Files:**
- Modify: `examples/dsh-customer-service-suite/README.md`
- Modify: `examples/dsh-customer-service-suite/docs/module-map.md`
- Modify: `docs/superpowers/plans/2026-08-27-customer-service-sqlite-acceptance.md` only to check completed steps and record exact verification evidence.

**Interfaces:**
- Documents the three database commands, database location, backup behavior, Node 22 warning, and restart acceptance flow.
- Produces final reproducible evidence for the specification acceptance criteria.

- [ ] **Step 1: Update usage documentation**

Replace the statement that all customer state is in memory. Document SQLite as acceptance-only, list the five persisted entity types, state which services remain in memory, and include exact `db:init`, `db:inspect`, `db:reset`, install, and Web restart commands.

- [ ] **Step 2: Run full automated verification**

Run:

```bash
npx -y pnpm@11.7.0 run customer-service:verify
npx -y pnpm@11.7.0 run customer-service:package
npx -y pnpm@11.7.0 run customer-service:db:inspect
```

Expected: all TypeScript builds, all old and new tests, package creation, Bundle counts, schema version, seed version, and entity counts pass.

- [ ] **Step 3: Install from the feature checkout and inspect Profile paths**

Stop any task-owned Web process, then run:

```bash
npx -y pnpm@11.7.0 run customer-service:db:reset
npx -y pnpm@11.7.0 run customer-service:install:web
rg -n "customer-sqlite-storage|databasePath|customer-service.db" /Users/mac/.dsh/profiles/web/cordis.patch.yml /Users/mac/.dsh/profiles/web/package.json /Users/mac/.dsh/profiles/web/pnpm-lock.yaml
```

Expected: one storage node, exact project database path, and no stale artifact path from an earlier worktree after final integration.

- [ ] **Step 4: Run the real Web persistence scenario**

Start Web:

```bash
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
```

In separate Harness chats, execute these exact requests:

```text
必须调用 query_inventory 工具查询商品 sku-1002，只返回工具结果。
```

```text
必须调用 mock_set_inventory 工具把商品 sku-1002 的库存设置为 5，只返回工具结果。
```

Stop and restart Web, then repeat the first query. Expected values are 0 before mutation and 5 after restart. Run `customer-service:db:reset`, then query again and expect 0. Confirm a backup file exists.

- [ ] **Step 5: Run independent completion checks**

Run:

```bash
git diff --check
git status --short --branch
rg -n "customer-service\.db" .gitignore data/README.md examples/dsh-customer-service-suite/README.md
find data -maxdepth 2 -type f -print
```

Confirm only source/docs are tracked, generated database artifacts are ignored, the user's `.DS_Store` remains untouched, and no high-severity acceptance gap remains.

- [ ] **Step 6: Commit Task 6**

```bash
git add examples/dsh-customer-service-suite/README.md examples/dsh-customer-service-suite/docs/module-map.md docs/superpowers/plans/2026-08-27-customer-service-sqlite-acceptance.md
git commit -m "docs: explain sqlite customer acceptance workflow"
```

- [ ] **Step 7: Present integration choices**

After fresh verification, use `superpowers:finishing-a-development-branch` to offer exactly: local merge to `main`, push/create PR, or keep the feature branch. Do not remove the worktree until the installed Profile database and tarball paths have been rewritten from the final chosen checkout.
