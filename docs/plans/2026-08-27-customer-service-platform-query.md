# Customer Service Platform and Query Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立模块化客服套件的 workspace、共享 Service 和聚合 Bundle，并交付独立的订单、物流、库存查询插件及一键验证、打包、安装能力。

**Architecture:** 新套件位于 `examples/dsh-customer-service-suite/`，共享 domain/state/events/approval 包只通过公开接口通信，查询插件分别注入 `customerState` 并注册一个工具。生产和演示 Bundle 组合这些独立包；旧 `dsh-plugin-order-query` 保留为行为基线，Web Profile 只在阶段验收通过后切换到新演示 Bundle。

**Tech Stack:** TypeScript 6.0.3、Node.js 22.19+、Vitest 4.1.8、pnpm 11.7.0、Cordis 4.0.1、`@deepseek-ai/dsh-tools` 0.1.1-rc.2、`@deepseek-ai/dsh-agent` 0.1.1-rc.2、DeepSeek Harness Bundle Patch

**Spec:** `docs/superpowers/specs/2026-08-27-modular-customer-service-suite-design.md`

## Global Constraints

- 本计划只实施规格的“平台与查询阶段”；售后工具和四类主动提醒由后续独立计划实施。
- 在 `examples/dsh-customer-service-suite/` 建立独立 pnpm workspace；现有两个示例不加入该 workspace。
- 根目录 `package.json` 只能保存委托脚本，不声明套件依赖。
- 包名、插件名、工具名和公开类型必须与规格一致。
- `ORDER-1001`、`ORDER-1002` 的 `query_order`、`query_logistics` 基线结果和中文文案必须保持精确兼容。
- 新 `query_order` 成功状态枚举增加 `delivered`、`cancelled`，但阶段一不修改任何订单状态。
- `query_inventory` 唯一参数是必填字符串 `sku`，输出使用严格 `oneOf`。
- 共享可变数据只能由 `customerState` Service 持有，功能插件不得导入种子 `Map`。
- `customerEvents` 订阅必须从工具执行 Agent 派生会话 ID；模型参数不能指定会话 ID。
- `customerApproval` 只批准四个精确的 `confirm_*` 工具名；本阶段不注册这些业务工具。
- 所有输出对象设置 `additionalProperties: false`，联合分支使用布尔 `const`。
- 所有时间判断使用可注入时钟；测试不等待真实时间。
- 所有包版本固定为 `0.1.0`，内部依赖使用 `workspace:^`。
- 每个 `Service` 构造函数调用 `super(ctx, '<context-key>')` 完成注册；依赖该 Service 的插件通过 `inject` 声明，不直接创建第二个实例。
- 包配置使用统一规则：`type: module`、`files: ["lib"]`、`exports["."]: "./lib/index.js"`、`build: tsc -p tsconfig.json`、`test: vitest run`；插件和 Bundle 额外把 `cordis.patch.yml` 加入 `files` 并声明对应 `dsh.bundle.patch`。
- 共享包依赖矩阵固定为：domain 无内部依赖；state 依赖 domain 与 Cordis；events 依赖 domain、Cordis、dsh-agent、dsh-llm；approval 依赖 domain、Cordis、dsh-tools。查询和 mock 插件依赖所消费的共享包、Cordis 与 dsh-tools。两个 Bundle 只声明其 Patch 中出现的模块为 `workspace:^` 依赖。
- 所有 pnpm 命令使用 `npx -y pnpm@11.7.0`。
- 使用 TDD；每项行为必须先看到相关测试因缺失行为失败，再实现最小代码。
- 在隔离 Worktree 中执行；完整验证后才合并 `main`、迁移 Web Profile 和清理 Worktree。

## File Map

- `package.json`：仓库根目录三个客服套件委托脚本。
- `examples/dsh-customer-service-suite/package.json`：独立 workspace 脚本和统一开发依赖。
- `examples/dsh-customer-service-suite/pnpm-workspace.yaml`：共享包、插件和 Bundle 成员。
- `examples/dsh-customer-service-suite/tsconfig.base.json`：统一 TypeScript 选项。
- `examples/dsh-customer-service-suite/packages/customer-domain/`：共享类型、规范化、错误代码、时钟接口和种子工厂。
- `examples/dsh-customer-service-suite/packages/customer-state/`：内存状态 Service、快照和受控修改接口。
- `examples/dsh-customer-service-suite/packages/customer-events/`：订阅、投递、去重和会话绑定 Service。
- `examples/dsh-customer-service-suite/packages/customer-approval/`：确认记录、幂等结果、审计和批准守卫。
- `examples/dsh-customer-service-suite/plugins/query-order/`：独立 `query_order` 插件。
- `examples/dsh-customer-service-suite/plugins/query-logistics/`：独立 `query_logistics` 插件。
- `examples/dsh-customer-service-suite/plugins/query-inventory/`：独立 `query_inventory` 插件。
- `examples/dsh-customer-service-suite/plugins/mock-operations/`：演示状态修改工具；本阶段实现库存、物流和时钟，退款更新在售后阶段补齐。
- `examples/dsh-customer-service-suite/bundles/customer-service-suite/`：生产组合层。
- `examples/dsh-customer-service-suite/bundles/customer-service-demo/`：演示组合层。
- `examples/dsh-customer-service-suite/scripts/`：验证、打包、安装和 Bundle 检查脚本。
- `examples/dsh-customer-service-suite/tests/`：跨包契约、Bundle 和旧插件兼容测试。

---

### Task 1: Workspace 与纯领域模型

**Files:**

- Create: `package.json`
- Create: `examples/dsh-customer-service-suite/package.json`
- Create: `examples/dsh-customer-service-suite/pnpm-workspace.yaml`
- Create: `examples/dsh-customer-service-suite/tsconfig.base.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-domain/package.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-domain/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-domain/src/index.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-domain/src/seeds.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-domain/tests/domain.test.mjs`

**Interfaces:**

- Consumes: 无。
- Produces: `normalizeBusinessId()`、`Clock`、`MutableClock`、`Order`、`Inventory`、`Logistics`、`ReturnRequest`、`Refund`、`CustomerAction`、`ActionConfirmation`、`AuditRecord`、`CustomerDomainEvent`、`AlertSubscription`、`createSeedState()`。

- [ ] **Step 1: 创建 workspace 配置和领域失败测试**

根目录 `package.json` 使用精确内容：

```json
{
  "name": "deepseek-harness-learning-workspace",
  "private": true,
  "scripts": {
    "customer-service:verify": "npx -y pnpm@11.7.0 --dir examples/dsh-plugin-order-query install --frozen-lockfile && npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite install --frozen-lockfile && npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite run verify",
    "customer-service:package": "npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite run package:suite",
    "customer-service:install:web": "npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite run install:web"
  }
}
```

套件 `package.json`：

```json
{
  "name": "dsh-customer-service-suite-workspace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r --if-present build",
    "test": "pnpm -r --if-present test",
    "verify": "pnpm build && pnpm test && node scripts/verify-bundles.mjs",
    "package:suite": "node scripts/package-suite.mjs",
    "install:web": "node scripts/install-web.mjs"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vitest": "4.1.8",
    "yaml": "2.8.1"
  },
  "engines": {
    "node": "^22.19.0 || >=24.0.0"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - packages/*
  - plugins/*
  - bundles/*
```

`tsconfig.base.json` 使用精确内容：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "lib",
    "rootDir": ".",
    "skipLibCheck": true
  }
}
```

领域包 `package.json` 使用统一规则，包名为 `@dsh-customer-service/domain`；其
`tsconfig.json` 固定为：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib" },
  "include": ["src/**/*.ts"]
}
```

测试必须断言：标识规范化、空标识错误、假时钟前进、种子深拷贝、`ORDER-1001/1002/1003` 和 `SKU-1001/1002` 精确值。

```js
import { describe, expect, it } from 'vitest'
import {
  InvalidBusinessIdError,
  MutableClock,
  createSeedState,
  normalizeBusinessId,
} from '../src/index.ts'

describe('customer domain', () => {
  it('normalizes business identifiers', () => {
    expect(normalizeBusinessId(' order-1001 ')).toBe('ORDER-1001')
    expect(() => normalizeBusinessId('   ')).toThrow(InvalidBusinessIdError)
  })

  it('advances a deterministic clock', () => {
    const clock = new MutableClock('2026-08-27T12:00:00+08:00')
    clock.advanceHours(2)
    expect(clock.now().toISOString()).toBe('2026-08-27T06:00:00.000Z')
  })

  it('returns independent seed graphs', () => {
    const first = createSeedState()
    const second = createSeedState()
    first.orders.get('ORDER-1002').address = '已修改地址'
    expect(second.orders.get('ORDER-1002').address).not.toBe('已修改地址')
    expect(second.inventories.get('SKU-1002').stock).toBe(0)
  })
})
```

- [ ] **Step 2: 运行领域测试确认 RED**

Run:

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-customer-service-suite"
npx -y pnpm@11.7.0 install
npx -y pnpm@11.7.0 --filter @dsh-customer-service/domain test
```

Expected: FAIL，报告 `src/index.ts` 或导出符号不存在。

- [ ] **Step 3: 实现领域类型、时钟和精确种子**

`src/index.ts` 必须导出以下公开接口：

```ts
export type OrderStatus = 'processing' | 'shipped' | 'delivered' | 'cancelled'
export type LogisticsStatus =
  | 'pending_shipment'
  | 'in_transit'
  | 'delivered'
  | 'delivery_failed'
export type RefundStatus = 'pending' | 'processing' | 'succeeded' | 'failed'
export type AlertType =
  | 'logistics_anomaly'
  | 'product_restock'
  | 'delivery'
  | 'refund_progress'

export interface Clock {
  now(): Date
}

export class MutableClock implements Clock {
  #current: Date
  constructor(initial: string) {
    this.#current = new Date(initial)
    if (Number.isNaN(this.#current.valueOf())) throw new Error('无效的初始时间。')
  }
  now() { return new Date(this.#current) }
  advanceHours(hours: number) {
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('前进小时数必须大于 0。')
    this.#current = new Date(this.#current.valueOf() + hours * 3_600_000)
  }
}

export class InvalidBusinessIdError extends Error {
  constructor() {
    super('业务编号不能为空。')
    this.name = 'InvalidBusinessIdError'
  }
}

export function normalizeBusinessId(raw: string): string {
  const value = raw.trim().toUpperCase()
  if (!value) throw new InvalidBusinessIdError()
  return value
}
```

`src/seeds.ts` 必须创建新的 `Map` 和新的嵌套对象；不得返回模块级可变单例。`ORDER-1001/1002` 的字段从旧插件复制，`ORDER-1003`、`SKU-1001/1002` 使用规格第 6.8 节的值。

- [ ] **Step 4: 验证 GREEN、构建和产物**

```bash
npx -y pnpm@11.7.0 --filter @dsh-customer-service/domain test
npx -y pnpm@11.7.0 --filter @dsh-customer-service/domain build
test -f packages/customer-domain/lib/index.js
test -f packages/customer-domain/lib/index.d.ts
```

Expected: 领域测试全部通过，四条命令退出码均为 `0`。

- [ ] **Step 5: 提交 workspace 与领域模型**

```bash
git add package.json examples/dsh-customer-service-suite
git commit -m "feat: scaffold modular customer service domain"
```

---

### Task 2: CustomerState 内存状态 Service

**Files:**

- Create: `examples/dsh-customer-service-suite/packages/customer-state/package.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-state/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-state/src/index.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-state/tests/state.test.mjs`

**Interfaces:**

- Consumes: `Clock`、`Order`、`Inventory`、`Logistics`、`ReturnRequest`、`Refund`、`createSeedState()`。
- Produces: `CustomerStateService`，Cordis `ctx.customerState`，只读快照方法和串行修改方法。

- [ ] **Step 1: 写 Service 失败测试**

```js
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CustomerStateService from '../src/index.ts'

describe('customerState service', () => {
  it('returns detached snapshots', () => {
    const ctx = new Context()
    const state = new CustomerStateService(ctx)
    const order = state.getOrder('order-1002')
    order.address = '外部篡改'
    expect(state.getOrder('ORDER-1002').address).not.toBe('外部篡改')
  })

  it('serializes updates and increments versions', async () => {
    const state = new CustomerStateService(new Context())
    const updated = await state.updateInventory('sku-1002', () => ({ stock: 5 }))
    expect(updated.before.version).toBe(1)
    expect(updated.after).toMatchObject({ stock: 5, version: 2 })
  })

  it('rejects negative stock without changing state', async () => {
    const state = new CustomerStateService(new Context())
    await expect(state.updateInventory('SKU-1002', () => ({ stock: -1 })))
      .rejects.toThrow('库存不能小于 0。')
    expect(state.getInventory('SKU-1002').stock).toBe(0)
  })
})
```

同一测试文件还必须先创建一条退货和一条退款，断言 `before === null`、版本从 1 开始、
`findReturnByOrder()`/`findRefundByOrder()` 返回深拷贝，并断言重复 ID 创建失败且不产生新事件。

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --filter @dsh-customer-service/state test
```

Expected: FAIL，报告 `CustomerStateService` 不存在或没有 `getOrder()`。

- [ ] **Step 3: 实现公开 Service 契约**

实现以下准确方法；所有返回值使用 `structuredClone()`：

```ts
export interface StateChange<T> {
  readonly before: T | null
  readonly after: T
  readonly event: CustomerDomainEvent
}

export default class CustomerStateService extends Service {
  constructor(ctx: Context, options?: { clock?: Clock })
  get clock(): Clock
  getOrder(raw: string): Order | undefined
  getLogistics(raw: string): Logistics | undefined
  getInventory(raw: string): Inventory | undefined
  getReturn(raw: string): ReturnRequest | undefined
  findReturnByOrder(rawOrderId: string): ReturnRequest | undefined
  getRefund(raw: string): Refund | undefined
  findRefundByOrder(rawOrderId: string): Refund | undefined
  async updateOrder(
    raw: string,
    patch: (current: Readonly<Order>) => Partial<Order>,
  ): Promise<StateChange<Order>>
  async updateLogistics(
    raw: string,
    patch: (current: Readonly<Logistics>) => Partial<Logistics>,
  ): Promise<StateChange<Logistics>>
  async updateInventory(
    raw: string,
    patch: (current: Readonly<Inventory>) => Partial<Inventory>,
  ): Promise<StateChange<Inventory>>
  async createReturn(value: Omit<ReturnRequest, 'version'>): Promise<StateChange<ReturnRequest>>
  async updateReturn(
    raw: string,
    patch: (current: Readonly<ReturnRequest>) => Partial<ReturnRequest>,
  ): Promise<StateChange<ReturnRequest>>
  async createRefund(value: Omit<Refund, 'version'>): Promise<StateChange<Refund>>
  async updateRefund(
    raw: string,
    patch: (current: Readonly<Refund>) => Partial<Refund>,
  ): Promise<StateChange<Refund>>
  async advanceClock(hours: number): Promise<{
    before: string
    after: string
    event: CustomerDomainEvent
  }>
}
```

构造函数第一行必须执行 `super(ctx, 'customerState')`；文件同时扩展 Cordis
`Context` 类型，使 `ctx.customerState` 的类型为 `CustomerStateService`。未知实体修改抛出
固定的 `EntityNotFoundError`，且测试断言失败写入不会增加版本或产生事件。成功修改在替换
记录后构造事件：order=`order.updated`、logistics=`logistics.updated`、inventory=
`inventory.changed`、return=`return.updated`、refund=`refund.updated`、时钟=
`clock.advanced`；事件版本等于提交后的实体版本，时钟使用内部递增版本。创建方法在目标 ID
已存在时抛 `EntityAlreadyExistsError`，按订单查找返回版本最高的独立快照。实体事件 payload
固定为深冻结的 `{ before, after }`，创建时 `before: null`；时钟事件 payload 固定为
`{ hours, before, after }`。Service 只返回事件，不自行调用 `customerEvents`，由完成业务事务的插件
在锁释放后发布。

每个 `update*` 以规范化实体 ID 作为 Promise 队列键；前一个写入结算后才能进入下一个写入。修改函数收到深冻结快照，Service 合并允许字段、验证不变量、自动增加 `version` 和 `updatedAt`，再一次性替换记录。

- [ ] **Step 4: 运行 Service 测试和构建**

```bash
npx -y pnpm@11.7.0 --filter @dsh-customer-service/state test
npx -y pnpm@11.7.0 --filter @dsh-customer-service/state build
```

Expected: 快照、版本、串行写和非法库存测试全部通过。

- [ ] **Step 5: 提交状态 Service**

```bash
git add examples/dsh-customer-service-suite/packages/customer-state
git commit -m "feat: add customer state service"
```

---

### Task 3: CustomerEvents 会话订阅 Service

**Files:**

- Create: `examples/dsh-customer-service-suite/packages/customer-events/package.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-events/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-events/src/index.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-events/tests/events.test.mjs`

**Interfaces:**

- Consumes: `Agent.id`、`Agent.followup()`、`AlertType`、`CustomerDomainEvent`。
- Produces: `CustomerEventsService`，Cordis `ctx.customerEvents`，订阅、取消、发布和投递结果接口。

- [ ] **Step 1: 写订阅、隔离和去重失败测试**

测试使用两个带不同 `id` 和 `followup` spy 的假 Agent，覆盖：

```js
const first = events.subscribe({
  sessionId: 'SESSION-A',
  alertType: 'product_restock',
  targetId: 'SKU-1002',
})
const duplicate = events.subscribe({
  sessionId: 'SESSION-A',
  alertType: 'product_restock',
  targetId: 'sku-1002',
})
expect(duplicate.subscriptionId).toBe(first.subscriptionId)
expect(events.list('SESSION-B')).toEqual([])

events.registerMatcher('product_restock', () => [{
  subscriptionId: first.subscriptionId,
  message: '商品 SKU-1002 已补货。',
  fingerprint: 'inventory:2',
}])
await events.publish(event)
await events.publish(event)
expect(agentA.followup).toHaveBeenCalledTimes(1)
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --filter @dsh-customer-service/events test
```

Expected: FAIL，报告 Service 或 `subscribe()` 不存在。

- [ ] **Step 3: 实现精确公开接口**

```ts
export interface AlertMatch {
  readonly subscriptionId: string
  readonly message: string
  readonly fingerprint: string
}

export interface DeliveryRecord {
  readonly subscriptionId: string
  readonly eventId: string
  readonly status: 'delivered' | 'delivery_failed'
  readonly message: string
}

export type AlertMatcher = (
  event: CustomerDomainEvent,
  subscriptions: readonly AlertSubscription[],
) => readonly AlertMatch[]

export default class CustomerEventsService extends Service {
  constructor(ctx: Context, options?: { resolveAgent?: (id: string) => Agent | undefined })
  subscribe(input: { sessionId: string; alertType: AlertType; targetId: string }): AlertSubscription
  list(sessionId: string): AlertSubscription[]
  cancel(sessionId: string, subscriptionId: string): boolean
  registerMatcher(alertType: AlertType, matcher: AlertMatcher): () => void
  async publish(event: CustomerDomainEvent): Promise<DeliveryRecord[]>
}
```

提醒插件用 `registerMatcher()` 注册自己的纯匹配器；生产事件的 state/业务/mock 插件只调用
`publish(event)`，不能导入提醒插件。`publish()` 按订阅提醒类型调用当前匹配器，再以
`subscriptionId + eventId` 阻止同一事件重复投递，并跳过与订阅
`lastTriggeredFingerprint` 相同的匹配；成功投递后同时保存事件 `version` 和 fingerprint。同一提醒
类型只能注册一个匹配器，卸载时由返回的 disposer 精确移除。

构造函数第一行必须执行 `super(ctx, 'customerEvents')`，类声明
`static inject = ['agents']`。生产解析器使用 `ctx.agents.get(sessionId)`。投递消息使用当前
Harness 0.1.1-rc.2 的精确结构：

```ts
const followup = createUserMessage({
  content: [{ type: 'text', text: match.message }],
  source: {
    kind: 'plugin',
    plugin: '@dsh-customer-service/events',
    form: 'notice',
    summary: '客服主动提醒',
  },
})
agent.followup(followup)
```

测试必须断言 `followup.role === 'user'`、`source.kind === 'plugin'`、插件名和文本块；不使用类型断言绕过。

- [ ] **Step 4: 验证事件 Service**

```bash
npx -y pnpm@11.7.0 --filter @dsh-customer-service/events test
npx -y pnpm@11.7.0 --filter @dsh-customer-service/events build
```

Expected: 会话隔离、重复订阅、重复事件、成功投递和 Agent 消失记录测试通过。

- [ ] **Step 5: 提交事件 Service**

```bash
git add examples/dsh-customer-service-suite/packages/customer-events
git commit -m "feat: add customer event subscription service"
```

---

### Task 4: CustomerApproval 确认与批准守卫 Service

**Files:**

- Create: `examples/dsh-customer-service-suite/packages/customer-approval/package.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-approval/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/packages/customer-approval/src/index.ts`
- Create: `examples/dsh-customer-service-suite/packages/customer-approval/tests/approval.test.mjs`

**Interfaces:**

- Consumes: `Clock`、工具 `tools/pre-execute` 事件。
- Produces: `CustomerApprovalService`，Cordis `ctx.customerApproval`，一次性确认、审计和四工具白名单守卫。

- [ ] **Step 1: 写确认生命周期和守卫失败测试**

测试固定覆盖：

```js
const confirmation = approval.issue({
  action: 'cancel_order',
  targetId: 'order-1002',
  payload: { reason: '不需要了' },
})
expect(approval.validate(confirmation.confirmationId, 'cancel_order'))
  .toMatchObject({ valid: true, targetId: 'ORDER-1002' })

const applied = approval.recordApplied(confirmation.confirmationId, {
  before: { status: 'processing' },
  after: { status: 'cancelled' },
})
expect(approval.recordApplied(confirmation.confirmationId, {
  before: { status: 'tampered' },
  after: { status: 'tampered' },
})).toEqual({
  ...applied,
  alreadyApplied: true,
})

expect(requiresHarnessApproval('confirm_refund')).toBe(true)
expect(requiresHarnessApproval('query_order')).toBe(false)
expect(requiresHarnessApproval('confirm_unrelated_plugin')).toBe(false)
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --filter @dsh-customer-service/approval test
```

Expected: FAIL，报告 `issue()` 或 `requiresHarnessApproval()` 不存在。

- [ ] **Step 3: 实现确认、幂等、审计和精确白名单**

```ts
export const APPROVAL_TOOL_NAMES = new Set([
  'confirm_cancel_order',
  'confirm_return_order',
  'confirm_refund',
  'confirm_address_change',
])

export function requiresHarnessApproval(name: string): boolean {
  return APPROVAL_TOOL_NAMES.has(name)
}

export type ConfirmationValidation =
  | { valid: true; targetId: string; payload: Readonly<Record<string, unknown>> }
  | { valid: false; code: 'CONFIRMATION_NOT_FOUND' | 'CONFIRMATION_EXPIRED' | 'CONFIRMATION_ACTION_MISMATCH' }

export interface AppliedResult {
  auditId: string
  confirmationId: string
  before: Readonly<Record<string, unknown>>
  after: Readonly<Record<string, unknown>>
  alreadyApplied: boolean
}

export default class CustomerApprovalService extends Service {
  constructor(ctx: Context, options?: { clock?: Clock; idFactory?: () => string })
  issue(input: {
    action: CustomerAction
    targetId: string
    payload: Readonly<Record<string, unknown>>
  }): ActionConfirmation
  validate(confirmationId: string, expectedAction: CustomerAction): ConfirmationValidation
  recordApplied(confirmationId: string, change: {
    before: Readonly<Record<string, unknown>>
    after: Readonly<Record<string, unknown>>
  }): AppliedResult
  getAudit(auditId: string): AuditRecord | undefined
}
```

`issue()` 使用规范化 action/target/payload、可注入 ID 工厂和 `clock.now()` 生成 10 分钟有效记录。`validate()` 返回可辨识联合而不是抛业务异常。`recordApplied()` 在首次调用写入不可变审计快照，重复调用返回原审计 ID 和 `alreadyApplied: true`。

构造函数第一行必须执行 `super(ctx, 'customerApproval')`，类声明
`static inject = ['tools']`。注册 `tools/pre-execute` waterfall 时：白名单工具精确返回
`{ kind: 'ask', reason: '该操作将修改客服业务数据。' } satisfies PreToolDecision`，其他工具
`return next()`。测试分别触发白名单、前缀相似但未列入白名单、普通查询三类名字。

- [ ] **Step 4: 验证 Approval Service**

```bash
npx -y pnpm@11.7.0 --filter @dsh-customer-service/approval test
npx -y pnpm@11.7.0 --filter @dsh-customer-service/approval build
```

Expected: 有效、过期、重复应用、审计不可变和白名单测试通过。

- [ ] **Step 5: 提交 Approval Service**

```bash
git add examples/dsh-customer-service-suite/packages/customer-approval
git commit -m "feat: add customer action approval service"
```

---

### Task 5: 模块化 query_order 插件

**Files:**

- Create: `examples/dsh-customer-service-suite/plugins/query-order/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/query-order/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/query-order/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/query-order/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/query-order/tests/plugin.test.mjs`
- Create: `examples/dsh-customer-service-suite/tests/query-order-compat.test.mjs`

**Interfaces:**

- Consumes: `ctx.customerState.getOrder(orderId)`、`ctx.customerState.getLogistics(orderId)`。
- Produces: 独立 `query_order`，兼容旧结果并新增 `delivered/cancelled` 标签。

- [ ] **Step 1: 写插件和基线兼容失败测试**

测试必须从旧插件与新插件分别加载 `query_order`，对以下输入比较 canonical value 和 render：

```js
for (const orderId of ['ORDER-1001', 'order-1002', 'unknown-001']) {
  expect(await newTool.execute({ orderId })).toEqual(
    await legacyTool.execute({ orderId }),
  )
  expect(newTool.output.render({}, await newTool.execute({ orderId }))).toEqual(
    legacyTool.output.render({}, await legacyTool.execute({ orderId })),
  )
}
```

另行断言成功 Schema 枚举为 `['shipped', 'processing', 'delivered', 'cancelled']`，渲染新增状态为“已签收”“已取消”。

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-order test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/query-order-compat.test.mjs
```

Expected: FAIL，新插件或工具尚不存在。

- [ ] **Step 3: 实现独立工具**

插件导出：

```ts
export const name = 'customer-query-order'
export const inject = ['tools', 'customerState'] as const
```

工具名称、参数和错误文本保持旧插件精确值。成功结果从 `Order` 与同订单 `Logistics`
两个快照映射：`estimatedDelivery` 取自 Order，`logisticsStatus` 取自
`Logistics.currentStatus`，避免保存重复可变状态。`ORDER-1001/1002` 继续使用旧插件的精确
预计日期和中文物流状态。订单存在但物流缺失视为服务一致性错误并包装为
`订单查询服务暂时不可用，请稍后重试。`。未知订单返回旧 `found: false` 结果。Schema 只增加两个状态枚举值，不增加额外输出字段。

适配器在调用 state 前检查 `orderId.trim()`；空值抛出与旧插件同名同文案的
`InvalidOrderIdError('订单号不能为空。')`，此输入错误不得被服务错误包装。测试加入空白订单号和
state 抛出意外错误两个分支。

- [ ] **Step 4: 验证新插件、兼容测试和构建**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-order test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/query-order-compat.test.mjs
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-order build
```

Expected: 新插件测试和三个输入兼容比较全部通过。

- [ ] **Step 5: 提交订单查询插件**

```bash
git add examples/dsh-customer-service-suite/plugins/query-order \
  examples/dsh-customer-service-suite/tests/query-order-compat.test.mjs
git commit -m "feat: modularize customer order query"
```

---

### Task 6: 模块化 query_logistics 插件

**Files:**

- Create: `examples/dsh-customer-service-suite/plugins/query-logistics/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/query-logistics/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/query-logistics/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/query-logistics/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/query-logistics/tests/plugin.test.mjs`
- Create: `examples/dsh-customer-service-suite/tests/query-logistics-compat.test.mjs`

**Interfaces:**

- Consumes: `ctx.customerState.getLogistics(orderId)`。
- Produces: 独立 `query_logistics`，对旧三个输入保持 canonical value、严格 Schema 和多行渲染兼容。

- [ ] **Step 1: 写独立工具和兼容失败测试**

比较输入固定为 `ORDER-1001`、`ORDER-1002`、`unknown-001`；同时检查事件对象 `required` 精确为 `time/location/description`、`additionalProperties: false`。

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-logistics test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/query-logistics-compat.test.mjs
```

Expected: FAIL，新插件或工具未注册。

- [ ] **Step 3: 实现物流查询适配层**

```ts
export const name = 'customer-query-logistics'
export const inject = ['tools', 'customerState'] as const
```

从 `customerState` 获取快照，返回值和 render 代码复制既有已验收契约；不得导入旧 `logistics.ts` 或旧插件 `index.ts`。`ORDER-1003` 允许返回新增“已签收”物流快照，但不改变旧输入。

空白 `orderId` 同样抛出 `InvalidOrderIdError('订单号不能为空。')`；只有非输入类意外错误包装为
`物流查询服务暂时不可用，请稍后重试。` 并保留 `cause`。

- [ ] **Step 4: 验证兼容性和构建**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-logistics test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/query-logistics-compat.test.mjs
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-logistics build
```

Expected: 三个旧输入精确兼容，嵌套 Schema 严格，构建成功。

- [ ] **Step 5: 提交物流查询插件**

```bash
git add examples/dsh-customer-service-suite/plugins/query-logistics \
  examples/dsh-customer-service-suite/tests/query-logistics-compat.test.mjs
git commit -m "feat: modularize customer logistics query"
```

---

### Task 7: query_inventory 插件

**Files:**

- Create: `examples/dsh-customer-service-suite/plugins/query-inventory/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/query-inventory/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/query-inventory/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/plugins/query-inventory/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/query-inventory/tests/plugin.test.mjs`

**Interfaces:**

- Consumes: `ctx.customerState.getInventory(sku)`。
- Produces: `query_inventory({ sku })`。

- [ ] **Step 1: 写库存工具失败测试**

```js
expect(await tool.execute({ sku: ' sku-1001 ' })).toEqual({
  found: true,
  sku: 'SKU-1001',
  productName: '无线鼠标',
  stock: 12,
  inStock: true,
})
expect(await tool.execute({ sku: 'SKU-1002' })).toMatchObject({
  found: true,
  stock: 0,
  inStock: false,
})
expect(await tool.execute({ sku: 'unknown' })).toEqual({
  found: false,
  sku: 'UNKNOWN',
  message: '未找到商品 UNKNOWN，请检查 SKU。',
})
```

还要检查 `oneOf`、两个 `found.const`、严格对象、缺失 `sku` 和空白 SKU。

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-inventory test
```

Expected: FAIL，工具尚未实现。

- [ ] **Step 3: 实现库存工具和精确渲染**

成功文案：

```text
商品 SKU-1001（无线鼠标）当前库存 12 件，状态：有货。
```

缺货文案：

```text
商品 SKU-1002（机械键盘）当前库存 0 件，状态：缺货。
```

未知商品文案使用 canonical `message`。意外错误转换为 `库存查询服务暂时不可用，请稍后重试。` 并保留 `cause`。

空白 SKU 抛出 `InvalidSkuError('SKU 不能为空。')`，不包装为服务错误。

- [ ] **Step 4: 验证库存工具和构建**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-inventory test
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-inventory build
```

Expected: 有货、缺货、未知、缺参、空白和 Schema 测试全部通过。

- [ ] **Step 5: 提交库存查询插件**

```bash
git add examples/dsh-customer-service-suite/plugins/query-inventory
git commit -m "feat: add modular inventory query"
```

---

### Task 8: Bundle 骨架与演示操作

**Files:**

- Create: `examples/dsh-customer-service-suite/plugins/mock-operations/package.json`
- Create: `examples/dsh-customer-service-suite/plugins/mock-operations/tsconfig.json`
- Create: `examples/dsh-customer-service-suite/plugins/mock-operations/src/index.ts`
- Create: `examples/dsh-customer-service-suite/plugins/mock-operations/tests/plugin.test.mjs`
- Create: `examples/dsh-customer-service-suite/bundles/customer-service-suite/package.json`
- Create: `examples/dsh-customer-service-suite/bundles/customer-service-suite/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/bundles/customer-service-demo/package.json`
- Create: `examples/dsh-customer-service-suite/bundles/customer-service-demo/cordis.patch.yml`
- Create: `examples/dsh-customer-service-suite/scripts/verify-bundles.mjs`
- Create: `examples/dsh-customer-service-suite/tests/bundle.test.mjs`

**Interfaces:**

- Consumes: 四个共享包、三个查询插件、`customerState`、`customerEvents`。
- Produces: 生产/演示 Bundle；演示工具 `mock_set_inventory`、`mock_append_logistics_event`、`mock_advance_clock`。

- [ ] **Step 1: 写 Bundle 依赖和演示工具失败测试**

测试解析两个 `cordis.patch.yml` 并断言：

- 生产 Bundle 顺序是 state → events → approval → query-order → query-logistics → query-inventory。
- 演示 Bundle 包含生产六项并在最后增加 mock-operations。
- 每个 ID 和 name 只出现一次。
- 生产 Bundle 不包含任何 `mock_` 工具。

演示工具测试精确断言库存从 0 改为 5、物流版本增加、时钟前进 25 小时；未知实体和非法 stock/hours 返回固定错误。

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-mock-operations test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/bundle.test.mjs
```

Expected: FAIL，Bundle Patch 或模拟工具不存在。

- [ ] **Step 3: 实现两个显式 Bundle Patch**

生产 Patch 使用以下条目顺序：

```yaml
- insert:
    - id: customer-state
      name: '@dsh-customer-service/state'
    - id: customer-events
      name: '@dsh-customer-service/events'
    - id: customer-approval
      name: '@dsh-customer-service/approval'
    - id: customer-query-order
      name: dsh-plugin-customer-query-order
    - id: customer-query-logistics
      name: dsh-plugin-customer-query-logistics
    - id: customer-query-inventory
      name: dsh-plugin-customer-query-inventory
```

演示 Patch 重复以上明确组合，并增加：

```yaml
    - id: customer-mock-operations
      name: dsh-plugin-customer-mock-operations
```

两个 Bundle 的 `package.json` 对 Patch 中每个内部模块使用 `workspace:^`。`pnpm pack`
会把 workspace 协议重写为发布版本范围；打包清单按拓扑顺序先安装模块 tarball，再安装 Bundle
tarball，不使用 `pnpm.overrides`。

包名必须精确为：生产 `dsh-bundle-customer-service-suite`、演示
`dsh-bundle-customer-service-demo`、模拟插件 `dsh-plugin-customer-mock-operations`。生产 Bundle
依赖 Patch 中六个模块；演示 Bundle 依赖相同六个模块和 mock 插件。两者的 `dsh.bundle.patch`
分别指向本目录 `cordis.patch.yml`。

- [ ] **Step 4: 实现演示工具**

三个工具都注入 `tools`、`customerState`、`customerEvents`，使用严格 Schema。每个工具先
调用 Task 2 的修改接口，取得成功提交返回的 `event`，再 `await customerEvents.publish(event)`；
修改失败不得发布。`mock_append_logistics_event` 只接受
`pending_shipment/in_transit/delivered/delivery_failed` 枚举，追加事件后更新
`currentStatus` 中文标签和版本。

mock 插件还注册独立的 `tools/pre-execute` 精确白名单，仅对
`mock_set_inventory`、`mock_append_logistics_event`、`mock_advance_clock` 返回：

```ts
{ kind: 'ask', reason: '该演示操作将修改内存业务状态。' } satisfies PreToolDecision
```

其他工具必须 `return next()`。测试证明生产 Bundle 没有该守卫，演示三个写工具返回 `ask`，
`query_inventory` 与名字相似的 `mock_set_inventory_extra` 不会被拦截。

- [ ] **Step 5: 验证 Bundle 与模拟工具**

```bash
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-mock-operations test
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/bundle.test.mjs
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite run verify
```

Expected: Bundle 顺序、生产隔离、模拟修改和 workspace 全量测试/构建全部通过。

- [ ] **Step 6: 提交 Bundle 与演示工具**

```bash
git add examples/dsh-customer-service-suite/plugins/mock-operations \
  examples/dsh-customer-service-suite/bundles \
  examples/dsh-customer-service-suite/scripts/verify-bundles.mjs \
  examples/dsh-customer-service-suite/tests/bundle.test.mjs
git commit -m "feat: assemble customer service query bundles"
```

---

### Task 9: 一键打包与 Web Profile 安装

**Files:**

- Create: `examples/dsh-customer-service-suite/scripts/package-suite.mjs`
- Create: `examples/dsh-customer-service-suite/scripts/install-web.mjs`
- Create: `examples/dsh-customer-service-suite/tests/package-scripts.test.mjs`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: 已构建 workspace 包和 `dsh plugin --profile web add`。
- Produces: `dist/customer-service-suite/manifest.json`、所有模块 tarball、一键安装演示 Bundle。

- [ ] **Step 1: 写打包清单和命令构造失败测试**

测试把临时目录传给导出的纯函数，断言清单按以下拓扑排序：domain、state、events、approval、三个查询、mock-operations、生产 Bundle、演示 Bundle。每项包含 `name/version/file/sha256/kind`；同名或缺失 tarball 必须拒绝。

```js
expect(buildInstallArgs(manifest)).toEqual({
  dependencies: manifest.modules
    .filter((item) => item.kind !== 'bundle')
    .map((item) => item.file),
  bundle: manifest.modules.find(
    (item) => item.name === 'dsh-bundle-customer-service-demo',
  ).file,
})
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/package-scripts.test.mjs
```

Expected: FAIL，脚本导出不存在。

- [ ] **Step 3: 实现安全打包脚本**

`package-suite.mjs` 仅删除 `examples/dsh-customer-service-suite/dist/customer-service-suite/`，使用 `fs.rm(path, { recursive: true })` 前必须断言解析路径严格位于套件 `dist` 下且 basename 为 `customer-service-suite`。脚本先在旧基线目录和新套件目录分别运行 `pnpm install --frozen-lockfile`，再运行新套件 `pnpm run verify`；这是因为两个兼容测试直接加载旧插件并需要它自己的依赖解析根。之后按包路径执行 `pnpm pack --pack-destination <dist>`，计算 SHA-256 并写清单。

`.gitignore` 只追加：

```gitignore
examples/dsh-customer-service-suite/node_modules/
examples/dsh-customer-service-suite/**/node_modules/
examples/dsh-customer-service-suite/**/lib/
examples/dsh-customer-service-suite/dist/
```

- [ ] **Step 4: 实现安装脚本**

`install-web.mjs`：

1. 调用打包脚本。
2. 从 `DSH_HOME` 或默认 `~/.dsh` 解析 `profiles/web`，不修改凭据文件。
3. 使用 `pnpm --dir <profile> add <dependency tarballs...>` 安装非 Bundle 包。
4. 使用 `npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile web add <demo bundle tarball>` 更新 Bundle 列表。
5. 使用同一 CLI 执行 `dsh plugin --profile web remove dsh-plugin-order-query`；若旧 Bundle 不存在则视为无需迁移，不吞掉其他错误。
6. 运行 `dsh --profile web --dump-config`，断言三个查询工具节点和一个 mock 节点恰好各出现一次，并断言 `dsh-plugin-order-query` 不存在。
7. 不启动、停止或重启现有 Web 进程。

安装测试的注入执行器必须锁定命令顺序为“安装模块 → 添加演示 Bundle → 移除 legacy →
dump-config”，并覆盖“legacy 不存在”和“其他移除错误必须失败”两个分支。

- [ ] **Step 5: 验证清单、真实打包和 Dry Run 安装命令**

```bash
npx -y pnpm@11.7.0 --dir examples/dsh-customer-service-suite vitest run tests/package-scripts.test.mjs
npx -y pnpm@11.7.0 run customer-service:package
test -f examples/dsh-customer-service-suite/dist/customer-service-suite/manifest.json
```

安装测试使用临时 Profile 和注入的命令执行器，不触碰真实 `~/.dsh`。真实 Web Profile 只在 Task 10 验收时安装。

- [ ] **Step 6: 提交一键脚本**

```bash
git add package.json .gitignore examples/dsh-customer-service-suite/scripts \
  examples/dsh-customer-service-suite/tests/package-scripts.test.mjs
git commit -m "feat: package and install customer service suite"
```

---

### Task 10: 文档、全量验证、Web 验收与阶段收口

**Files:**

- Create: `examples/dsh-customer-service-suite/README.md`
- Create: `examples/dsh-customer-service-suite/docs/module-map.md`
- Modify: `examples/dsh-plugin-order-query/README.md`
- Verify: `/Users/mac/.dsh/profiles/web`
- Verify: `http://127.0.0.1:3080/`

**Interfaces:**

- Consumes: 本计划所有包、插件、Bundle 和一键脚本。
- Produces: 可复现安装说明、模块修改入口、真实三查询 Web 验收和下一阶段稳定基线。

- [ ] **Step 1: 写模块地图和使用文档**

README 必须包含：

- 每个共享包和查询插件的职责、目录和公开工具。
- `customer-service:verify/package/install:web` 三条根命令。
- 单模块修改、测试和构建示例。
- 生产与演示 Bundle 差异。
- 内存状态和重启清空限制。
- 后续阶段列表，不声称售后或主动提醒已经实现。

旧 README 增加醒目的 legacy baseline 说明，链接到新套件；不得删除旧测试和使用说明。

- [ ] **Step 2: 运行新旧全量自动验证**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
npx -y pnpm@11.7.0 run customer-service:verify
cd examples/dsh-plugin-order-query
npx -y pnpm@11.7.0 test
npx -y pnpm@11.7.0 build
```

Expected: 新 workspace 全部测试/构建成功；旧插件继续 `22 passed` 并构建成功。

- [ ] **Step 3: 提交文档**

```bash
git add examples/dsh-customer-service-suite/README.md \
  examples/dsh-customer-service-suite/docs/module-map.md \
  examples/dsh-plugin-order-query/README.md
git commit -m "docs: explain modular customer query suite"
```

- [ ] **Step 4: 安装真实 Web Profile 并检查配置**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
npx -y pnpm@11.7.0 run customer-service:install:web
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile web --dump-config
```

Expected: 配置包含 customer state/events/approval、三个查询和 mock-operations，各一次；不再加载 legacy `dsh-plugin-order-query`，也没有重复工具名。

- [ ] **Step 5: 重启 Web 服务并验证三个查询**

停止当前由本任务启动和持有的 Web PTY，再从仓库根目录启动：

```bash
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
```

在三个新会话分别发送：

```text
必须调用 query_order 工具查询订单 order-1001，只返回工具结果。
```

```text
必须调用 query_logistics 工具查询订单 order-1001 的物流轨迹，只返回工具结果。
```

```text
必须调用 query_inventory 工具查询商品 sku-1002，只返回工具结果。
```

Expected: 轨迹分别调用三个准确工具；前两个结果与旧基线一致，库存结果显示机械键盘、0 件、缺货。

- [ ] **Step 6: 阶段完成验证与合并**

在功能分支重新运行：

```bash
npx -y pnpm@11.7.0 run customer-service:verify
git diff --check
git status --short
```

使用 `superpowers:finishing-a-development-branch`，按用户选择合并到 `main`。合并后再次运行新旧完整测试和构建，从主工作区重新执行 `customer-service:install:web`，确认 Profile 不指向临时 Worktree，清理功能分支和 Worktree，再启动主工作区 Web 服务并验证 HTTP 200。

Expected final evidence:

- 新 workspace 所有测试与构建通过。
- 旧插件 `22/22` 测试通过。
- 三个真实 Web 查询通过。
- `main` 包含阶段提交。
- Web Profile 指向主工作区产物，不指向 `.worktrees/`。
- `git status --short` 为空。
