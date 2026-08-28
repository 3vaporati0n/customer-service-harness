# Customer Service After-Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DeepSeek Harness 模块化客服套件交付取消订单、退货、退款和修改地址四个可独立修改、预检、确认、审批、幂等执行和审计的售后插件。

**Architecture:** 每个售后能力是独立 Cordis 插件，分别注册一个 `request_*` 预检工具和一个 `confirm_*` 写工具。插件只能通过 `customerState`、`customerApproval` 和 `customerEvents` 的公开接口访问状态、确认、审计与事件；SQLite 升级到结构版本 3，以支持退货被拒或退款失败后重新申请，同时仍由确定性规则限制活动记录数量。

**Tech Stack:** TypeScript 6、Cordis 4、DeepSeek Harness tools、Vitest 4、Node 22 `node:sqlite`、pnpm 11.7。

**Spec:** `docs/superpowers/specs/2026-08-27-modular-customer-service-suite-design.md`

## Global Constraints

- 固定工具名和参数必须与规格第 5.2 节完全一致；所有 `confirm_*` 只接收 `confirmationId`。
- 取消、退货和退款均为整单操作；退款金额必须从订单 `totalAmount` 派生。
- 预检只创建 10 分钟确认，不修改业务实体；确认时必须重新检查最新资格。
- 每个确认写工具同时受 Harness `ask` 和一次性 `confirmationId` 两层保护。
- 重复执行同一已成功确认不得再次写入，必须返回原 `auditId` 并设置 `alreadyApplied: true`。
- 每个插件只能导入共享包，不得导入其他功能插件源码。
- 生产和演示 Bundle 都加载四个售后插件；演示 Bundle 继续额外加载模拟与测试数据工具。
- 保留 `.DS_Store` 和所有无关用户文件，不把验收数据库或备份提交到 Git。

---

### Task 1: Confirmation Replay API

**Files:**
- Modify: `examples/dsh-customer-service-suite/packages/customer-approval/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-approval/tests/approval.test.mjs`

**Interfaces:**
- Produces: `CustomerApprovalService.getApplied(confirmationId, expectedAction): AppliedResult | undefined`
- Preserves: `issue`, `validate`, `recordApplied`, `getAudit`

- [ ] **Step 1: Write the failing replay tests**

Add tests proving that `getApplied('id-1', 'cancel_order')` returns a detached saved result after `recordApplied`, returns `undefined` before application, and does not expose a result for an action mismatch.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/approval test
```

Expected: FAIL because `getApplied` does not exist.

- [ ] **Step 3: Implement the minimal replay lookup**

Normalize the confirmation ID, verify the stored confirmation action equals `expectedAction`, clone the saved `AppliedResult`, and return `undefined` for missing, unapplied, or mismatched confirmations.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 command and require all approval tests to pass.

- [ ] **Step 5: Commit**

```bash
git add examples/dsh-customer-service-suite/packages/customer-approval
git commit -m "feat: expose idempotent after-sales confirmations"
```

### Task 2: Active Return and Refund Storage Queries

**Files:**
- Modify: `examples/dsh-customer-service-suite/packages/customer-domain/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/src/schema.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/src/storage.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-storage-sqlite/tests/storage.test.mjs`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/src/memory-storage.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/tests/memory-storage.test.mjs`
- Modify: `examples/dsh-customer-service-suite/packages/customer-state/tests/state.test.mjs`
- Modify: `examples/dsh-customer-service-suite/tests/customer-db.test.mjs`

**Interfaces:**
- Produces: `CustomerStorage.listReturnsByOrder(orderId): ReturnRequest[]`
- Produces: `CustomerStorage.listRefundsByOrder(orderId): Refund[]`
- Produces: matching `CustomerStateService` read methods
- Migration: schema version `2 -> 3`, dropping the two one-per-order unique indexes while preserving rows

- [ ] **Step 1: Write failing storage and state tests**

Cover two returns on one order when the first is `rejected`, two refunds when the first is `failed`, detached list snapshots, deterministic newest-first ordering, and a version-2 database migration that preserves existing records.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/storage-sqlite test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter @dsh-customer-service/state test
```

Expected: FAIL because list APIs and schema version 3 do not exist.

- [ ] **Step 3: Implement schema v3 and list APIs**

Add a transaction-safe v3 migration:

```sql
DROP INDEX IF EXISTS return_requests_one_per_order_idx;
DROP INDEX IF EXISTS refunds_one_per_order_idx;
PRAGMA user_version = 3;
```

Return cloned rows ordered by `created_at DESC, return_id DESC` and `updated_at DESC, refund_id DESC`. Keep existing `find*ByOrder` methods as compatibility wrappers over the first list result.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run both Task 2 commands and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add examples/dsh-customer-service-suite/packages/customer-domain examples/dsh-customer-service-suite/packages/customer-storage-sqlite examples/dsh-customer-service-suite/packages/customer-state examples/dsh-customer-service-suite/tests/customer-db.test.mjs
git commit -m "feat: support repeat after-sales applications"
```

### Task 3: Cancel Order Plugin

**Files:**
- Create: `examples/dsh-customer-service-suite/plugins/cancel-order/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/cancel-order/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/cancel-order/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/cancel-order/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/cancel-order/tests/plugin.test.mjs`

**Interfaces:**
- Produces: `request_cancel_order({ orderId, reason })`
- Produces: `confirm_cancel_order({ confirmationId })`
- Eligibility: only `processing`; other known states return `ORDER_ALREADY_SHIPPED`

- [ ] **Step 1: Write failing plugin tests**

Assert strict schemas, normalized IDs, nonblank reason, unknown order rejection, shipped rejection, request confirmation payload, confirm revalidation after state change, successful `cancelled` transition, event publication, audit ID, Harness approval name, and idempotent replay.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-cancel-order test
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement the two tools**

Use `defineCustomerTool`, `customerState`, `customerApproval`, and `customerEvents`. On confirmation, return a saved applied result before expiry/eligibility checks; otherwise validate, recheck, update the order, record audit, publish `order.updated`, and render concise Chinese text.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 3 command and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add examples/dsh-customer-service-suite/plugins/cancel-order
git commit -m "feat: add cancel order workflow"
```

### Task 4: Change Address Plugin

**Files:**
- Create: `examples/dsh-customer-service-suite/plugins/change-address/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/change-address/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/change-address/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/change-address/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/change-address/tests/plugin.test.mjs`

**Interfaces:**
- Produces: `request_address_change({ orderId, newAddress })`
- Produces: `confirm_address_change({ confirmationId })`
- Eligibility: only `processing`; nonblank complete address string

- [ ] **Step 1: Write failing plugin tests**

Cover strict schemas, blank address, unknown order, shipped refusal, normalized confirmation payload, successful persisted address update, stale-state revalidation, audit, event and replay.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-change-address test
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement the two tools**

Follow the same public Service boundary as Task 3, but update only `Order.address`. Bind the trimmed address into the confirmation payload and audit before/after snapshots.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 4 command and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add examples/dsh-customer-service-suite/plugins/change-address
git commit -m "feat: add address change workflow"
```

### Task 5: Return Order Plugin

**Files:**
- Create: `examples/dsh-customer-service-suite/plugins/return-order/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/return-order/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/return-order/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/return-order/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/return-order/tests/plugin.test.mjs`

**Interfaces:**
- Produces: `request_return_order({ orderId, reason })`
- Produces: `confirm_return_order({ confirmationId })`
- Creates: `ReturnRequest` with generated `RETURN-*` ID and status `approved`

- [ ] **Step 1: Write failing plugin tests**

Cover unknown and non-delivered orders, missing/invalid `deliveredAt`, exactly seven days accepted, beyond seven days rejected as `RETURN_WINDOW_EXPIRED`, existing `approved`/`received` rejected, existing `rejected` allowed, request-bound generated ID, successful creation, event, audit, stale eligibility and replay.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-return-order test
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement deterministic return eligibility and tools**

Compare the injected `customerState.clock.now()` with `deliveredAt` using `7 * 24 * 60 * 60 * 1000`; bind `returnId` and trimmed reason to the confirmation. Confirm by `customerState.createReturn({ status: 'approved' })`, then audit and publish.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 5 command and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add examples/dsh-customer-service-suite/plugins/return-order
git commit -m "feat: add return order workflow"
```

### Task 6: Refund Plugin

**Files:**
- Create: `examples/dsh-customer-service-suite/plugins/refund-order/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/refund-order/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/refund-order/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/refund-order/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/refund-order/tests/plugin.test.mjs`

**Interfaces:**
- Produces: `request_refund({ orderId, reason })`
- Produces: `confirm_refund({ confirmationId })`
- Creates: `Refund` with generated `REFUND-*` ID, derived total amount, optional eligible return ID, status `pending`

- [ ] **Step 1: Write failing plugin tests**

Cover unknown order, ineligible processing/shipped order, cancelled order refund, approved/received return refund, rejected return refusal, amount derived from order and absent from input schema, existing pending/processing/succeeded rejection, existing failed refund retry, successful creation, event, audit, stale eligibility and replay.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-refund-order test
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement deterministic refund eligibility and tools**

Select the newest `approved`/`received` return when the order is not cancelled. Bind generated `refundId`, derived `amount`, optional `returnId`, and trimmed reason into the confirmation; confirm by creating a `pending` refund, then audit and publish.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 6 command and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add examples/dsh-customer-service-suite/plugins/refund-order
git commit -m "feat: add refund workflow"
```

### Task 7: Bundle, Packaging and Documentation Integration

**Files:**
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-suite/package.json`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-suite/cordis.patch.yml`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-demo/package.json`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-demo/cordis.patch.yml`
- Modify: `examples/dsh-customer-service-suite/scripts/package-suite.mjs`
- Modify: `examples/dsh-customer-service-suite/scripts/install-web.mjs`
- Modify: `examples/dsh-customer-service-suite/scripts/verify-bundles.mjs`
- Modify: `examples/dsh-customer-service-suite/tests/bundle.test.mjs`
- Modify: `examples/dsh-customer-service-suite/tests/package-scripts.test.mjs`
- Modify: `examples/dsh-customer-service-suite/README.md`
- Modify: `examples/dsh-customer-service-suite/docs/module-map.md`
- Regenerate: `examples/dsh-customer-service-suite/pnpm-lock.yaml`

**Interfaces:**
- Production Bundle: 11 entries (4 runtime shared services + 3 queries + 4 after-sales)
- Demo Bundle: 13 entries (production + mock operations + test data entry)
- Package manifest: 16 modules

- [ ] **Step 1: Write failing bundle and packaging assertions**

Require all four plugin package names and config IDs exactly once, preserve dependency ordering, reject duplicate or missing nodes, and require a 16-module package manifest.

- [ ] **Step 2: Run focused suite tests and verify RED**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite exec vitest run tests/bundle.test.mjs tests/package-scripts.test.mjs
```

Expected: FAIL because bundles, manifest and installer do not include the new plugins.

- [ ] **Step 3: Wire packages and update operator documentation**

Add the four workspace dependencies and patch nodes, include the packages in `MODULES` and `REQUIRED_CONFIG_IDS`, update expected counts, document each request/confirm sequence, and mark only proactive reminders as not yet implemented.

- [ ] **Step 4: Refresh the lockfile and verify GREEN**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite install
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite exec vitest run tests/bundle.test.mjs tests/package-scripts.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add examples/dsh-customer-service-suite
git commit -m "feat: integrate after-sales service plugins"
```

### Task 8: Full Verification and Real Web Acceptance

**Files:**
- Modify only if a test exposes a defect; every fix must start with a failing regression test.

**Interfaces:**
- Root verification: `customer-service:verify`
- Packaging/install: `customer-service:package`, `customer-service:install:web`
- Web acceptance: rejection plus one complete request/confirm/approval flow

- [ ] **Step 1: Run complete automated verification**

```bash
npx -y pnpm@11.7.0 run customer-service:verify
npx -y pnpm@11.7.0 run customer-service:package
npx -y pnpm@11.7.0 run customer-service:install:web
```

Require zero test/build failures, production Bundle 11, demo Bundle 13, package manifest 16, and all installed config IDs exactly once.

- [ ] **Step 2: Reset acceptance data and start Web**

```bash
npx -y pnpm@11.7.0 run customer-service:db:reset
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
```

- [ ] **Step 3: Run real Harness flows**

Verify at minimum:

```text
必须调用 request_cancel_order，为订单 ORDER-1001 申请取消，原因为不需要了，只返回工具结果。
```

Expected: `accepted: false` with shipped/cannot-cancel reason.

Then in a fresh session:

```text
必须调用 request_address_change，为订单 ORDER-1002 申请把地址修改为江苏省苏州市工业园区测试路 8 号，只返回工具结果。
```

Copy the returned confirmation ID into:

```text
必须调用 confirm_address_change，确认编号为 <confirmationId>，只返回工具结果。
```

Approve once in Harness and verify `query_order` plus direct SQLite inspection show the new address and incremented version. Repeat the same confirmation and verify `alreadyApplied: true` with no second version increment.

- [ ] **Step 4: Restore seed data and inspect final state**

```bash
npx -y pnpm@11.7.0 run customer-service:db:reset
npx -y pnpm@11.7.0 run customer-service:db:inspect
git diff --check
git status --short
```

Require schema version 3, seed counts restored, no generated root lockfile/node_modules left behind, and only pre-existing unrelated user files untracked.

- [ ] **Step 5: Independent verifier pass**

Map all four features to successful and rejected tests, check no plugin imports another plugin, inspect strict schemas and approval names, and rerun `customer-service:verify` after the final code change.
