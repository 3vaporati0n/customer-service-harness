# Refund Progress Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Harness 能通过自然语言订阅退款进度，并在退款状态真实变化时向原会话主动发送一次提醒。

**Architecture:** 新建独立 `refund-progress-alert` 插件，注册订阅工具和 `refund.updated` 事件匹配器；继续复用 `CustomerEventsService` 的会话隔离、去重和主动投递。演示 Bundle 的 `mock-operations` 增加受批准保护的退款状态变更工具，用于可重复验收。

**Tech Stack:** TypeScript 6、Vitest 4、DeepSeek Harness/Cordis、pnpm workspace、SQLite

**Spec:** `docs/superpowers/specs/2026-08-27-modular-customer-service-suite-design.md`

## Global Constraints

- 工具名固定为 `subscribe_refund_progress_alert`，唯一业务参数为 `refundId`。
- 会话 ID 只能来自工具执行上下文，模型不得提供 `sessionId`。
- 未知退款返回结构化业务拒绝；重复订阅返回同一个活动订阅。
- 只有 `refund.updated` 且退款状态真实变化时提醒；同一事件和状态指纹不得重复投递。
- `mock_set_refund_status` 仅进入演示 Bundle，并继续受 Harness 写操作批准策略保护。

---

### Task 1: 退款进度订阅插件

**Files:**
- Create: `examples/dsh-customer-service-suite/plugins/refund-progress-alert/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/refund-progress-alert/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/refund-progress-alert/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/refund-progress-alert/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/refund-progress-alert/tests/plugin.test.mjs`

**Interfaces:**
- Consumes: `customerState.getRefund(refundId)`、`customerEvents.subscribe(...)`、`customerEvents.registerMatcher(...)`、工具执行上下文的 `agent.id`
- Produces: `subscribe_refund_progress_alert({ refundId })`

- [ ] **Step 1: Write the failing plugin test**

测试必须覆盖：工具注册；缺少 Agent 返回 `ALERT_SESSION_REQUIRED`；未知退款返回 `REFUND_NOT_FOUND`；同会话重复订阅幂等；`pending → processing` 发送一次中文提醒；相同状态不提醒。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite exec vitest run plugins/refund-progress-alert/tests/plugin.test.mjs`

Expected: FAIL，因为插件尚不存在。

- [ ] **Step 3: Implement the minimal plugin**

注册严格参数工具；从 `exec.agent?.id` 取得会话；确认退款存在后订阅 `refund_progress`；匹配 `refund.updated` 事件中 `before.status !== after.status` 的目标退款，并生成基于新状态和版本的指纹。

- [ ] **Step 4: Run focused tests**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-refund-progress-alert test`

Expected: PASS。

### Task 2: 演示状态变更与 Bundle 接入

**Files:**
- Modify: `examples/dsh-customer-service-suite/plugins/mock-operations/src/index.ts`
- Modify: `examples/dsh-customer-service-suite/plugins/mock-operations/tests/plugin.test.mjs`
- Modify: `examples/dsh-customer-service-suite/scripts/package-suite.mjs`
- Modify: `examples/dsh-customer-service-suite/scripts/install-web.mjs`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-suite/package.json`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-suite/cordis.patch.yml`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-demo/package.json`
- Modify: `examples/dsh-customer-service-suite/bundles/customer-service-demo/cordis.patch.yml`
- Modify: `examples/dsh-customer-service-suite/pnpm-lock.yaml`

**Interfaces:**
- Consumes: `customerState.updateRefund(refundId, patch)`
- Produces: `mock_set_refund_status({ refundId, status })`

- [ ] **Step 1: Write the failing mock-operation tests**

断言第四个写工具存在、批准策略覆盖它，并且状态从 `pending` 更新为 `processing` 后发布 `refund.updated`，触发已注册提醒。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite --filter dsh-plugin-customer-mock-operations test`

Expected: FAIL，因为工具尚未注册。

- [ ] **Step 3: Implement and wire modules**

实现严格状态枚举 `pending | processing | succeeded | failed`，更新退款并发布事件；把新插件加入生产与演示 Bundle、打包清单和 Web 安装配置。

- [ ] **Step 4: Update the workspace lockfile**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite install --lockfile-only`

Expected: 新插件及两个 Bundle 的 workspace 依赖进入锁文件。

### Task 3: 全量和 Web 验收

**Files:**
- Updated local profile: `/Users/mac/.dsh/profiles/web`

**Interfaces:**
- Consumes: suite verify/install scripts and Harness Web
- Produces: 可自然语言订阅并收到退款进度通知的本地验收环境

- [ ] **Step 1: Run full verification**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite verify`

Expected: build、全部测试和 Bundle 验证通过。

- [ ] **Step 2: Install and restart Web Profile**

Run: `npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite install:web`

Expected: 配置中每个模块恰好出现一次，Harness HTTP 返回 200。

- [ ] **Step 3: Perform natural-language acceptance**

在退款会话发送“这笔退款状态有变化时提醒我”，预期调用 `subscribe_refund_progress_alert`；再发送“把这笔验收退款状态改成处理中”，批准 `mock_set_refund_status`，预期同一会话收到插件主动提醒且不创建通用 goal。
