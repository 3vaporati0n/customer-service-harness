# Order-to-Inventory Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让订单查询结果提供商品 SKU，使 Harness 能只通过客服工具完成订单到库存的自然语言跨模块查询。

**Architecture:** 扩展 `query_order` 的结构化成功结果和中文渲染，不把库存职责合并进订单插件。模型读取订单商品 SKU 后继续调用现有 `query_inventory`。

**Tech Stack:** TypeScript 6、Vitest 4、DeepSeek Harness/Cordis、pnpm workspace

**Spec:** `docs/superpowers/specs/2026-08-28-order-inventory-linkage-design.md`

## Global Constraints

- 保持 `query_order(orderId)` 的名称和输入不变。
- 保持 `query_inventory(sku)` 为独立工具。
- 不修改库存、订单或 SQLite 数据。
- 先写失败测试，再写生产代码。

---

### Task 1: 扩展订单查询契约

**Files:**
- Modify: `examples/dsh-customer-service-suite/plugins/query-order/tests/plugin.test.mjs`
- Modify: `examples/dsh-customer-service-suite/plugins/query-order/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/tests/query-order-compat.test.mjs`

**Interfaces:**
- Consumes: `CustomerStateService.getOrder(orderId): Order | undefined`
- Produces: `query_order` 成功结果中的 `items: Array<{ sku: string; quantity: number; unitPrice: number }>`

- [ ] **Step 1: Write the failing test**

为成功订单夹具加入 `items`，断言 Schema 必填 `items`，执行结果包含商品数组，渲染文本包含 SKU。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-query-order test`

Expected: FAIL，因为当前 Schema、执行结果和渲染文本均无 `items`。

- [ ] **Step 3: Write minimal implementation**

在成功分支 Schema 中增加严格的 `items` 数组；执行时复制 `order.items` 所需字段；渲染时追加 `商品：<SKU> ×<quantity>（单价 <unitPrice> 元）`。

- [ ] **Step 4: Run focused tests**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-query-order test`

Expected: PASS。

- [ ] **Step 5: Adjust compatibility assertion**

已知订单只比较旧字段并单独断言新增 `items`；未知订单仍完整比较旧值和渲染。

### Task 2: 全量验证与 Harness 验收

**Files:**
- Generated: `examples/dsh-customer-service-suite/**/lib/*`
- Updated local profile: `/Users/mac/.dsh/profiles/web`

**Interfaces:**
- Consumes: suite package/build/install scripts
- Produces: Web Profile 中含新订单工具契约的可运行 Bundle

- [ ] **Step 1: Run full verification**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite verify`

Expected: build、所有测试、Bundle 验证全部成功。

- [ ] **Step 2: Install Web Profile**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite install:web`

Expected: 本地 Web Profile 重装成功且配置检查通过。

- [ ] **Step 3: Restart and accept in Harness**

新会话发送“帮我查一下订单 ORDER-1002 现在是什么状态？”，随后发送“这笔订单里的商品现在还有库存吗？”。

Expected: 依次调用 `query_order` 和 `query_inventory`，不出现 Bash；库存结果为 `SKU-1002` 当前 `0` 件、缺货。
