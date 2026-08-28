# Order Query Customer Service Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 `dsh-plugin-order-query` 客服插件，让 DeepSeek Harness 可以通过 `query_order` 查询模拟订单并返回经过 Schema 校验的中文结果。

**Architecture:** `src/orders.ts` 是不依赖 Harness 的订单业务模块，负责类型、模拟数据、订单号标准化和查询；`src/index.ts` 是 Harness 适配层，负责工具注册、输入与输出 Schema、安全异常转换和文本渲染。TypeScript 可辨识联合类型与 `output.schema.oneOf` 共同约束成功和未找到两种返回值。

**Tech Stack:** TypeScript 6.0.3、Node.js 22.19+、Vitest 4.1.8、pnpm 11.7.0、DeepSeek Harness / `@deepseek-ai/dsh-tools` 0.1.1-rc.2、Cordis 4.0.1

**Spec:** `docs/superpowers/specs/2026-08-26-order-query-plugin-design.md`

## Global Constraints

- 新插件目录必须为 `examples/dsh-plugin-order-query`，不能修改已有 `dsh-plugin-beginner-greet`。
- 工具名称必须精确为 `query_order`，唯一参数必须为必填字符串 `orderId`。
- 订单号必须通过 `trim().toUpperCase()` 标准化；标准化后为空必须抛出 `订单号不能为空。`。
- `ORDER-1001` 必须返回 `shipped`、`运输中`、`2026-08-28`。
- `ORDER-1002` 必须返回 `processing`、`待发货`、`2026-08-30`。
- 未知非空订单必须返回 `found: false` 和 `未找到该订单，请检查订单号。`，不能抛异常。
- 输出 Schema 必须使用 `oneOf`、`found.const` 和 `additionalProperties: false` 严格区分两个分支。
- 意外内部异常必须转换为 `订单查询服务暂时不可用，请稍后重试。`，并通过 `cause` 保留原始错误。
- 业务模块不得导入 Harness；适配层不得复制订单查询规则。
- 不增加数据库、网络、认证、缓存、重试或写操作。
- 所有 pnpm 命令通过 `npx -y pnpm@11.7.0` 执行，不能假设全局安装了 pnpm。
- 保留用户已有改动，不修改本计划范围之外的文件。

## File Map

- `examples/dsh-plugin-order-query/package.json`：包入口、构建测试脚本、精确依赖版本和 Bundle Patch 声明。
- `examples/dsh-plugin-order-query/pnpm-lock.yaml`：由 pnpm 11.7.0 生成的可复现依赖解析。
- `examples/dsh-plugin-order-query/tsconfig.json`：NodeNext、严格类型、声明文件和 `lib` 输出配置。
- `examples/dsh-plugin-order-query/src/orders.ts`：订单领域类型、模拟数据、标准化、查询和输入错误。
- `examples/dsh-plugin-order-query/src/index.ts`：Harness 插件元数据、`query_order` 注册、Schema、异常转换和渲染。
- `examples/dsh-plugin-order-query/tests/orders.test.mjs`：不依赖 Harness 的业务测试。
- `examples/dsh-plugin-order-query/tests/plugin.test.mjs`：插件接口、Schema、执行和渲染测试。
- `examples/dsh-plugin-order-query/cordis.patch.yml`：将插件作为 `order-query-tool` 插入 Bundle。
- `examples/dsh-plugin-order-query/README.md`：面向初学者的原理、命令、Profile 配置与验收说明。

---

### Task 1: 用测试驱动建立订单业务模块

**Files:**

- Create: `examples/dsh-plugin-order-query/package.json`
- Create: `examples/dsh-plugin-order-query/pnpm-lock.yaml`
- Create: `examples/dsh-plugin-order-query/tsconfig.json`
- Create: `examples/dsh-plugin-order-query/tests/orders.test.mjs`
- Create: `examples/dsh-plugin-order-query/src/orders.ts`

**Interfaces:**

- Consumes: 原始字符串订单号。
- Produces: `OrderStatus`、`OrderRecord`、`OrderQueryResult`、`InvalidOrderIdError`、`normalizeOrderId(raw: string): string`、`findOrder(raw: string): OrderQueryResult`。

- [ ] **Step 1: 创建最小包清单和 TypeScript 配置**

使用 `apply_patch` 创建：

```diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/package.json
+{
+  "name": "dsh-plugin-order-query",
+  "version": "0.1.0",
+  "private": true,
+  "type": "module",
+  "files": [
+    "lib",
+    "cordis.patch.yml"
+  ],
+  "exports": {
+    ".": "./lib/index.js"
+  },
+  "scripts": {
+    "build": "tsc -p tsconfig.json",
+    "test": "vitest run"
+  },
+  "dependencies": {
+    "@deepseek-ai/cordis": "4.0.1",
+    "@deepseek-ai/dsh-tools": "0.1.1-rc.2"
+  },
+  "devDependencies": {
+    "typescript": "6.0.3",
+    "vitest": "4.1.8"
+  },
+  "dsh": {
+    "bundle": {
+      "patch": "cordis.patch.yml"
+    }
+  },
+  "engines": {
+    "node": "^22.19.0 || >=24.0.0"
+  }
+}
*** Add File: examples/dsh-plugin-order-query/tsconfig.json
+{
+  "compilerOptions": {
+    "target": "ES2022",
+    "module": "NodeNext",
+    "moduleResolution": "NodeNext",
+    "strict": true,
+    "declaration": true,
+    "outDir": "lib",
+    "rootDir": "src",
+    "skipLibCheck": true
+  },
+  "include": [
+    "src/**/*.ts"
+  ]
+}
*** End Patch
```

- [ ] **Step 2: 安装精确依赖并生成锁文件**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 install
```

Expected: 退出码为 `0`；生成 `pnpm-lock.yaml` 和被 Git 忽略的 `node_modules/`；没有修改相邻插件。

- [ ] **Step 3: 先写订单业务测试**

使用 `apply_patch` 创建 `tests/orders.test.mjs`：

```diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/tests/orders.test.mjs
+import { describe, expect, it } from 'vitest'
+
+import {
+  findOrder,
+  InvalidOrderIdError,
+  normalizeOrderId,
+} from '../src/orders.ts'
+
+describe('order lookup domain', () => {
+  it('returns the known shipped order', () => {
+    expect(findOrder('ORDER-1001')).toEqual({
+      found: true,
+      orderId: 'ORDER-1001',
+      status: 'shipped',
+      logisticsStatus: '运输中',
+      estimatedDelivery: '2026-08-28',
+    })
+  })
+
+  it('returns the known processing order', () => {
+    expect(findOrder('ORDER-1002')).toEqual({
+      found: true,
+      orderId: 'ORDER-1002',
+      status: 'processing',
+      logisticsStatus: '待发货',
+      estimatedDelivery: '2026-08-30',
+    })
+  })
+
+  it('normalizes surrounding whitespace and letter case', () => {
+    expect(normalizeOrderId(' order-1001 ')).toBe('ORDER-1001')
+    expect(findOrder(' order-1001 ')).toEqual(findOrder('ORDER-1001'))
+  })
+
+  it('returns a normal not-found result for an unknown order', () => {
+    expect(findOrder('unknown-001')).toEqual({
+      found: false,
+      orderId: 'UNKNOWN-001',
+      message: '未找到该订单，请检查订单号。',
+    })
+  })
+
+  it('rejects an order id that is empty after normalization', () => {
+    expect(() => findOrder('   ')).toThrow(InvalidOrderIdError)
+    expect(() => findOrder('   ')).toThrow('订单号不能为空。')
+  })
+})
*** End Patch
```

- [ ] **Step 4: 运行测试，确认它因业务模块尚不存在而失败**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test tests/orders.test.mjs
```

Expected: FAIL，错误包含无法解析 `../src/orders.ts`。如果测试意外通过，先检查是否错误引用了其他插件的文件。

- [ ] **Step 5: 写入满足测试的订单业务实现**

使用 `apply_patch` 创建 `src/orders.ts`：

```diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/src/orders.ts
+export type OrderStatus = 'shipped' | 'processing'
+
+export interface OrderRecord {
+  readonly orderId: string
+  readonly status: OrderStatus
+  readonly logisticsStatus: string
+  readonly estimatedDelivery: string
+}
+
+export type OrderQueryResult =
+  | ({ readonly found: true } & OrderRecord)
+  | {
+      readonly found: false
+      readonly orderId: string
+      readonly message: string
+    }
+
+export class InvalidOrderIdError extends Error {
+  constructor() {
+    super('订单号不能为空。')
+    this.name = 'InvalidOrderIdError'
+  }
+}
+
+const ORDERS: Readonly<Partial<Record<string, OrderRecord>>> = {
+  'ORDER-1001': {
+    orderId: 'ORDER-1001',
+    status: 'shipped',
+    logisticsStatus: '运输中',
+    estimatedDelivery: '2026-08-28',
+  },
+  'ORDER-1002': {
+    orderId: 'ORDER-1002',
+    status: 'processing',
+    logisticsStatus: '待发货',
+    estimatedDelivery: '2026-08-30',
+  },
+}
+
+export function normalizeOrderId(raw: string): string {
+  return raw.trim().toUpperCase()
+}
+
+export function findOrder(raw: string): OrderQueryResult {
+  const orderId = normalizeOrderId(raw)
+  if (!orderId) throw new InvalidOrderIdError()
+
+  const order = ORDERS[orderId]
+  if (!order) {
+    return {
+      found: false,
+      orderId,
+      message: '未找到该订单，请检查订单号。',
+    }
+  }
+
+  return { found: true, ...order }
+}
*** End Patch
```

- [ ] **Step 6: 运行业务测试和 TypeScript 构建**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test tests/orders.test.mjs
npx -y pnpm@11.7.0 build
```

Expected: `orders.test.mjs` 的 `5` 个测试通过；构建退出码为 `0`；`lib/orders.js` 和 `lib/orders.d.ts` 被生成。

- [ ] **Step 7: 提交独立业务模块**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
git add examples/dsh-plugin-order-query/package.json \
  examples/dsh-plugin-order-query/pnpm-lock.yaml \
  examples/dsh-plugin-order-query/tsconfig.json \
  examples/dsh-plugin-order-query/src/orders.ts \
  examples/dsh-plugin-order-query/tests/orders.test.mjs
git commit -m "feat: add order lookup domain"
```

Expected: 提交包含包骨架、锁文件、业务源码和业务测试，不包含 `node_modules/` 或 `lib/`。

---

### Task 2: 用测试驱动接入 Harness 工具

**Files:**

- Create: `examples/dsh-plugin-order-query/tests/plugin.test.mjs`
- Create: `examples/dsh-plugin-order-query/src/index.ts`

**Interfaces:**

- Consumes: Task 1 的 `findOrder(raw: string): OrderQueryResult` 和 `InvalidOrderIdError`。
- Produces: `name = 'order-query'`、`inject = ['tools']`、`apply(ctx: Context): void`，以及参数 `{ orderId: string }`、联合输出和中文渲染组成的 `query_order` 工具。

- [ ] **Step 1: 先写插件契约测试**

使用 `apply_patch` 创建 `tests/plugin.test.mjs`：

```diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/tests/plugin.test.mjs
+import { describe, expect, it } from 'vitest'
+
+import { apply, inject, name } from '../src/index.ts'
+
+function loadPlugin() {
+  let registeredTool
+  const ctx = {
+    tools: {
+      register(tool) {
+        registeredTool = tool
+        return () => {
+          registeredTool = undefined
+        }
+      },
+    },
+  }
+
+  apply(ctx)
+  return registeredTool
+}
+
+describe('order-query plugin', () => {
+  it('declares the tools dependency and registers query_order', () => {
+    const tool = loadPlugin()
+
+    expect(name).toBe('order-query')
+    expect(inject).toEqual(['tools'])
+    expect(tool.name).toBe('query_order')
+    expect(tool.description).toContain('订单')
+    expect(tool.parameters).toMatchObject({
+      type: 'object',
+      properties: { orderId: { type: 'string' } },
+      required: ['orderId'],
+    })
+  })
+
+  it('compiles two strict output branches with boolean discriminants', () => {
+    const tool = loadPlugin()
+    const [found, notFound] = tool.output.schema.oneOf
+
+    expect(found.additionalProperties).toBe(false)
+    expect(found.properties.found).toEqual({ type: 'boolean', const: true })
+    expect(found.required).toEqual([
+      'found',
+      'orderId',
+      'status',
+      'logisticsStatus',
+      'estimatedDelivery',
+    ])
+    expect(notFound.additionalProperties).toBe(false)
+    expect(notFound.properties.found).toEqual({ type: 'boolean', const: false })
+    expect(notFound.properties.message).toEqual({
+      type: 'string',
+      const: '未找到该订单，请检查订单号。',
+    })
+    expect(notFound.required).toEqual(['found', 'orderId', 'message'])
+  })
+
+  it('returns and renders a known order', async () => {
+    const tool = loadPlugin()
+    const result = await tool.execute({ orderId: 'order-1001' })
+
+    expect(result).toEqual({
+      found: true,
+      orderId: 'ORDER-1001',
+      status: 'shipped',
+      logisticsStatus: '运输中',
+      estimatedDelivery: '2026-08-28',
+    })
+    expect(tool.output.render({}, result)).toEqual([
+      {
+        type: 'text',
+        text: '订单 ORDER-1001 当前状态：已发货；物流状态：运输中；预计送达时间：2026-08-28。',
+      },
+    ])
+  })
+
+  it('renders the processing status in Chinese', async () => {
+    const tool = loadPlugin()
+    const result = await tool.execute({ orderId: 'ORDER-1002' })
+
+    expect(result).toEqual({
+      found: true,
+      orderId: 'ORDER-1002',
+      status: 'processing',
+      logisticsStatus: '待发货',
+      estimatedDelivery: '2026-08-30',
+    })
+    expect(tool.output.render({}, result)).toEqual([
+      {
+        type: 'text',
+        text: '订单 ORDER-1002 当前状态：处理中；物流状态：待发货；预计送达时间：2026-08-30。',
+      },
+    ])
+  })
+
+  it('returns and renders a normal not-found result', async () => {
+    const tool = loadPlugin()
+    const result = await tool.execute({ orderId: 'unknown-001' })
+
+    expect(result).toEqual({
+      found: false,
+      orderId: 'UNKNOWN-001',
+      message: '未找到该订单，请检查订单号。',
+    })
+    expect(tool.output.render({}, result)).toEqual([
+      { type: 'text', text: '未找到订单 UNKNOWN-001，请检查订单号。' },
+    ])
+  })
+
+  it('lets defineTool reject a missing orderId', async () => {
+    const tool = loadPlugin()
+
+    await expect(tool.execute({})).rejects.toMatchObject({
+      name: 'ToolArgsError',
+      message: 'invalid arguments: missing required property "orderId"',
+    })
+  })
+
+  it('preserves the explicit blank-order input error', async () => {
+    const tool = loadPlugin()
+
+    await expect(tool.execute({ orderId: '   ' })).rejects.toThrow(
+      '订单号不能为空。',
+    )
+  })
+})
*** End Patch
```

- [ ] **Step 2: 运行插件测试，确认它因入口模块尚不存在而失败**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test tests/plugin.test.mjs
```

Expected: FAIL，错误包含无法解析 `../src/index.ts`。

- [ ] **Step 3: 写入 Harness 适配层**

使用 `apply_patch` 创建 `src/index.ts`：

```diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/src/index.ts
+import type { Context } from '@deepseek-ai/cordis'
+import { defineTool } from '@deepseek-ai/dsh-tools'
+
+import { findOrder, InvalidOrderIdError } from './orders.js'
+
+const STATUS_LABELS = {
+  shipped: '已发货',
+  processing: '处理中',
+} as const
+
+const ORDER_RESULT_SCHEMA = {
+  oneOf: [
+    {
+      type: 'object',
+      additionalProperties: false,
+      properties: {
+        found: { type: 'boolean', const: true, required: true },
+        orderId: { type: 'string', required: true },
+        status: {
+          type: 'string',
+          enum: ['shipped', 'processing'],
+          required: true,
+        },
+        logisticsStatus: { type: 'string', required: true },
+        estimatedDelivery: { type: 'string', required: true },
+      },
+    },
+    {
+      type: 'object',
+      additionalProperties: false,
+      properties: {
+        found: { type: 'boolean', const: false, required: true },
+        orderId: { type: 'string', required: true },
+        message: {
+          type: 'string',
+          const: '未找到该订单，请检查订单号。',
+          required: true,
+        },
+      },
+    },
+  ],
+} as const
+
+export const name = 'order-query'
+export const inject = ['tools'] as const
+
+export function apply(ctx: Context) {
+  ctx.tools.register(
+    defineTool({
+      name: 'query_order',
+      description: '根据订单号查询订单状态、物流状态和预计送达时间。',
+      parameters: {
+        orderId: {
+          type: 'string',
+          required: true,
+          description: '需要查询的订单号，例如 ORDER-1001。',
+        },
+      },
+      output: {
+        schema: ORDER_RESULT_SCHEMA,
+        render: (_args, value) => {
+          if (!value.found) {
+            return [
+              {
+                type: 'text',
+                text: `未找到订单 ${value.orderId}，请检查订单号。`,
+              },
+            ]
+          }
+
+          return [
+            {
+              type: 'text',
+              text: `订单 ${value.orderId} 当前状态：${STATUS_LABELS[value.status]}；物流状态：${value.logisticsStatus}；预计送达时间：${value.estimatedDelivery}。`,
+            },
+          ]
+        },
+      },
+      async execute(args) {
+        try {
+          return findOrder(args.orderId)
+        } catch (error) {
+          if (error instanceof InvalidOrderIdError) throw error
+          throw new Error('订单查询服务暂时不可用，请稍后重试。', {
+            cause: error,
+          })
+        }
+      },
+    }),
+  )
+}
*** End Patch
```

- [ ] **Step 4: 运行全部测试，确认业务层和适配层同时通过**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test
```

Expected: `2` 个测试文件通过、`12` 个测试通过；没有失败测试。

- [ ] **Step 5: 构建并检查可加载入口**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 build
rg -n "query_order|ORDER_RESULT_SCHEMA|findOrder|function apply" \
  lib/index.js lib/index.d.ts lib/orders.js lib/orders.d.ts
```

Expected: 构建退出码为 `0`；`lib/index.js` 包含工具注册和 Schema；声明文件导出 `apply`；`lib/orders.d.ts` 导出业务接口。

- [ ] **Step 6: 提交 Harness 适配层**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
git add examples/dsh-plugin-order-query/src/index.ts \
  examples/dsh-plugin-order-query/tests/plugin.test.mjs
git commit -m "feat: add order query harness tool"
```

Expected: 提交只包含插件入口和集成测试。

---

### Task 3: 接入 Bundle 并编写初学者文档

**Files:**

- Create: `examples/dsh-plugin-order-query/cordis.patch.yml`
- Create: `examples/dsh-plugin-order-query/README.md`

**Interfaces:**

- Consumes: Task 2 构建出的 `lib/index.js` 和 `package.json` 中的 `dsh.bundle.patch` 声明。
- Produces: Bundle 节点 `order-query-tool`，以及可以从安装、配置检查走到 Web UI 验收的完整命令说明。

- [ ] **Step 1: 创建 Bundle Patch**

使用 `apply_patch` 创建 `cordis.patch.yml`：

```diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/cordis.patch.yml
+- insert:
+    - id: order-query-tool
+      name: dsh-plugin-order-query
*** End Patch
```

- [ ] **Step 2: 创建完整 README**

使用 `apply_patch` 创建 `README.md`：

````diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/README.md
+# dsh-plugin-order-query
+
+这是一个用于学习 DeepSeek Harness 的最小客服订单查询插件。它注册 `query_order` 工具，查询内存中的模拟订单，并把结构化结果渲染成中文客服文本。
+
+测试和构建不需要 DeepSeek API Key；只有 Web UI 的模型调用需要已经配置好的 Provider。
+
+## 先看懂数据流
+
+```text
+用户问题
+  -> 模型选择 query_order
+  -> Harness 校验 orderId
+  -> orders.ts 标准化并查询订单
+  -> Harness 校验 oneOf 输出
+  -> render() 生成中文文本
+```
+
+- `src/orders.ts`：纯业务模块，不依赖 Harness。
+- `src/index.ts`：Harness 适配层，负责注册、Schema 和渲染。
+- `tests/orders.test.mjs`：验证标准化、查询和输入错误。
+- `tests/plugin.test.mjs`：验证工具接口、输出分支和中文文本。
+- `cordis.patch.yml`：把插件插入 Harness Bundle。
+
+## 模拟订单
+
+| 订单号 | 业务状态 | 物流状态 | 预计送达 |
+|---|---|---|---|
+| `ORDER-1001` | `shipped` | 运输中 | `2026-08-28` |
+| `ORDER-1002` | `processing` | 待发货 | `2026-08-30` |
+
+订单号会先执行 `trim()` 和 `toUpperCase()`，所以 ` order-1001 ` 也能匹配 `ORDER-1001`。未知非空订单返回 `found: false`；空订单号抛出输入错误。
+
+## 测试和构建
+
+需要 Node.js `22.19.0` 或更新的兼容版本：
+
+```bash
+cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
+npx -y pnpm@11.7.0 install
+npx -y pnpm@11.7.0 test
+npx -y pnpm@11.7.0 build
+```
+
+成功时应看到 `12 passed`，并在被 Git 忽略的 `lib/` 中生成 JavaScript 和声明文件。
+
+## 安装并检查 Bundle
+
+先安装到隔离的学习 Profile：
+
+```bash
+cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
+npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile order-query-guide add .
+npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile order-query-guide --dump-config
+```
+
+最终配置中应出现：
+
+```yaml
+# == dsh-plugin-order-query
+- id: order-query-tool
+  name: dsh-plugin-order-query
+```
+
+这一步只验证安装和配置组合，不调用模型。
+
+## 在 Web UI 中验证
+
+将插件安装到 `web` Profile 后重启服务：
+
+```bash
+cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
+npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile web add .
+npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile web --dump-config
+cd "/Users/mac/Documents/ChatGPT/deepseek harness"
+npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
+```
+
+在新会话输入：
+
+```text
+必须调用 query_order 工具查询订单 order-1001，只返回工具结果。
+```
+
+预期：
+
+```text
+订单 ORDER-1001 当前状态：已发货；物流状态：运输中；预计送达时间：2026-08-28。
+```
+
+再输入：
+
+```text
+必须调用 query_order 工具查询订单 unknown-001，只返回工具结果。
+```
+
+预期：
+
+```text
+未找到订单 UNKNOWN-001，请检查订单号。
+```
*** End Patch
````

- [ ] **Step 3: 重新运行自动验证**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test
npx -y pnpm@11.7.0 build
```

Expected: `12` 个测试通过；构建退出码为 `0`。

- [ ] **Step 4: 安装到隔离 Profile 并检查组合配置**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile order-query-guide add .
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile order-query-guide --dump-config
```

Expected: 最终配置末尾出现：

```yaml
# == dsh-plugin-order-query
- id: order-query-tool
  name: dsh-plugin-order-query
```

- [ ] **Step 5: 提交 Bundle 和 README**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
git add examples/dsh-plugin-order-query/cordis.patch.yml \
  examples/dsh-plugin-order-query/README.md
git commit -m "docs: add order query plugin guide"
```

Expected: 提交只包含 Bundle Patch 和 README。

---

### Task 4: 在 Web Harness 中完成端到端验收

**Files:**

- Verify only: `examples/dsh-plugin-order-query/lib/index.js`
- Verify only: `/Users/mac/.dsh/profiles/web/cordis.yml` 及该 Profile 的插件安装状态

**Interfaces:**

- Consumes: Task 2 的可加载插件和 Task 3 的 Bundle Patch。
- Produces: `query_order` 在 Web UI 中对已知订单和未知订单都被真实调用并返回预期文本的验收证据。

- [ ] **Step 1: 把本地插件安装到 web Profile**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile web add .
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile web --dump-config
```

Expected: 最终配置包含 `# == dsh-plugin-order-query` 和 `id: order-query-tool`。原有问候插件仍然存在，不被替换。

- [ ] **Step 2: 停止旧 Web Harness 进程**

在当前运行 Harness 的终端按：

```text
Control + C
```

Expected: 终端回到 shell 提示符。必须重启，因为旧 Node.js 进程不会自动加载新安装的插件。

- [ ] **Step 3: 启动新的 Web Harness 进程**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
```

Expected: 服务监听 `http://127.0.0.1:3080/`，启动日志没有插件解析或 `apply()` 错误。

- [ ] **Step 4: 验证已知订单**

打开 `http://127.0.0.1:3080/`，创建新会话并输入：

```text
必须调用 query_order 工具查询订单 order-1001，只返回工具结果。
```

Expected: 轨迹中出现 `query_order` 工具调用，结果精确为：

```text
订单 ORDER-1001 当前状态：已发货；物流状态：运输中；预计送达时间：2026-08-28。
```

- [ ] **Step 5: 验证未知订单**

在新会话输入：

```text
必须调用 query_order 工具查询订单 unknown-001，只返回工具结果。
```

Expected: 轨迹中出现同一个 `query_order` 工具调用；调用是成功状态而不是错误状态；结果精确为：

```text
未找到订单 UNKNOWN-001，请检查订单号。
```

- [ ] **Step 6: 做最终自动验证与仓库检查**

保持或停止 Web 服务均可，然后在另一个终端运行：

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test
npx -y pnpm@11.7.0 build
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
git diff --check
git status --short
git log -6 --oneline
```

Expected: `12` 个测试通过；构建退出码为 `0`；`git diff --check` 没有输出；计划内文件均已提交。任何剩余状态都必须明确属于用户原有或无关改动。

---

## Completion Evidence

只有同时取得以下证据才能宣告实现完成：

1. `orders.test.mjs` 的 `5` 个业务测试通过。
2. `plugin.test.mjs` 的 `7` 个插件测试通过。
3. TypeScript 构建成功，并生成 `lib/index.js`、`lib/index.d.ts`、`lib/orders.js` 和 `lib/orders.d.ts`。
4. `--dump-config` 显示 `dsh-plugin-order-query` 和 `order-query-tool`。
5. Web UI 的已知订单查询真实调用工具并返回物流信息。
6. Web UI 的未知订单查询真实调用工具、保持成功状态并返回未找到提示。
7. 最终 Git 检查没有计划内未提交改动或空白错误。
