# Order Logistics Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `dsh-plugin-order-query` 中新增独立的 `query_logistics` 工具，按订单号返回严格校验的物流轨迹数组，同时保持 `query_order` 零回归。

**Architecture:** `src/logistics.ts` 是不依赖 Harness 的物流业务模块，复用 `orders.ts` 的订单号标准化、输入错误和未找到提示；`src/index.ts` 继续作为 Harness 适配层，在同一个插件实例中注册两个工具。新工具使用可辨识联合类型和嵌套 `oneOf` 输出 Schema，渲染层把事件数组转换为中文多行文本。

**Tech Stack:** TypeScript 6.0.3、Node.js 22.19+、Vitest 4.1.8、pnpm 11.7.0、`@deepseek-ai/dsh-tools` 0.1.1-rc.2、Cordis 4.0.1

**Spec:** `docs/superpowers/specs/2026-08-27-order-logistics-query-design.md`

## Global Constraints

- 保留 `query_order` 的名称、参数、输出和中文文案。
- 新工具名称必须精确为 `query_logistics`，唯一参数必须为必填字符串 `orderId`。
- 复用 `normalizeOrderId()`、`InvalidOrderIdError` 和 `ORDER_NOT_FOUND_MESSAGE`，不得复制订单号规则。
- `ORDER-1001` 必须返回“运输中”和两条按时间正序排列的轨迹。
- `ORDER-1002` 必须返回“待发货”和一条商家仓库轨迹。
- 未知非空订单必须返回 `found: false`；空订单号必须抛出 `订单号不能为空。`。
- 输出 Schema 必须使用 `oneOf`、`found.const`、严格对象和严格嵌套事件对象。
- 意外内部异常必须转换为 `物流查询服务暂时不可用，请稍后重试。` 并保留 `cause`。
- 不新增依赖，不修改 `package.json`、`pnpm-lock.yaml`、`tsconfig.json` 或 `cordis.patch.yml`。
- 所有 pnpm 命令使用 `npx -y pnpm@11.7.0`。
- 在隔离 Worktree 中执行；完成验证后合并回 `main`，恢复 Web Profile 主工作区链接并清理临时分支。

## File Map

- `examples/dsh-plugin-order-query/src/logistics.ts`：物流类型、内存数据和纯查询函数。
- `examples/dsh-plugin-order-query/tests/logistics.test.mjs`：物流业务规则测试。
- `examples/dsh-plugin-order-query/src/index.ts`：注册两个工具，声明物流 Schema、异常转换和渲染。
- `examples/dsh-plugin-order-query/tests/plugin.test.mjs`：双工具注册、Schema、执行、渲染和参数错误测试。
- `examples/dsh-plugin-order-query/README.md`：双工具说明、模拟轨迹与 Web 验收命令。

---

### Task 1: 用测试驱动实现物流业务模块

**Files:**

- Create: `examples/dsh-plugin-order-query/tests/logistics.test.mjs`
- Create: `examples/dsh-plugin-order-query/src/logistics.ts`

**Interfaces:**

- Consumes: `normalizeOrderId(raw: string): string`、`InvalidOrderIdError`、`ORDER_NOT_FOUND_MESSAGE`。
- Produces: `LogisticsEvent`、`LogisticsQueryResult`、`findLogistics(raw: string): LogisticsQueryResult`。

- [ ] **Step 1: 写入失败的物流业务测试**

使用 `apply_patch` 创建 `tests/logistics.test.mjs`：

```diff
*** Begin Patch
*** Add File: examples/dsh-plugin-order-query/tests/logistics.test.mjs
+import { describe, expect, it } from 'vitest'
+
+import { findLogistics } from '../src/logistics.ts'
+import { InvalidOrderIdError } from '../src/orders.ts'
+
+describe('logistics lookup domain', () => {
+  it('returns ordered tracking events for ORDER-1001', () => {
+    expect(findLogistics('ORDER-1001')).toEqual({
+      found: true,
+      orderId: 'ORDER-1001',
+      currentStatus: '运输中',
+      events: [
+        {
+          time: '2026-08-26 09:20',
+          location: '上海分拨中心',
+          description: '包裹已发出',
+        },
+        {
+          time: '2026-08-26 18:40',
+          location: '苏州转运中心',
+          description: '包裹运输中',
+        },
+      ],
+    })
+  })
+
+  it('returns the pending shipment event for ORDER-1002', () => {
+    expect(findLogistics('ORDER-1002')).toEqual({
+      found: true,
+      orderId: 'ORDER-1002',
+      currentStatus: '待发货',
+      events: [
+        {
+          time: '2026-08-27 08:00',
+          location: '商家仓库',
+          description: '订单已创建，等待发货',
+        },
+      ],
+    })
+  })
+
+  it('normalizes whitespace and letter case', () => {
+    expect(findLogistics(' order-1001 ')).toEqual(findLogistics('ORDER-1001'))
+  })
+
+  it('returns a normal not-found result', () => {
+    expect(findLogistics('unknown-001')).toEqual({
+      found: false,
+      orderId: 'UNKNOWN-001',
+      message: '未找到该订单，请检查订单号。',
+    })
+  })
+
+  it('preserves the shared blank-order input error', () => {
+    expect(() => findLogistics('   ')).toThrow(InvalidOrderIdError)
+    expect(() => findLogistics('   ')).toThrow('订单号不能为空。')
+  })
+})
*** End Patch
```

- [ ] **Step 2: 运行测试并确认 RED**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test tests/logistics.test.mjs
```

Expected: FAIL，首先报告无法解析 `../src/logistics.ts`。然后用以下接口桩创建该文件：

```ts
export function findLogistics(_raw: string): never {
  throw new Error('not implemented')
}
```

再次运行同一命令，必须看到 5 个行为测试因 `not implemented` 而失败；此时才进入 GREEN。

- [ ] **Step 3: 实现最小物流业务模块**

使用 `apply_patch` 创建或替换 `src/logistics.ts`：

```ts
import {
  InvalidOrderIdError,
  normalizeOrderId,
  ORDER_NOT_FOUND_MESSAGE,
} from './orders.js'

export interface LogisticsEvent {
  readonly time: string
  readonly location: string
  readonly description: string
}

export type LogisticsQueryResult =
  | {
      readonly found: true
      readonly orderId: string
      readonly currentStatus: string
      readonly events: LogisticsEvent[]
    }
  | {
      readonly found: false
      readonly orderId: string
      readonly message: typeof ORDER_NOT_FOUND_MESSAGE
    }

interface LogisticsRecord {
  readonly currentStatus: string
  readonly events: LogisticsEvent[]
}

const LOGISTICS: Readonly<Partial<Record<string, LogisticsRecord>>> = {
  'ORDER-1001': {
    currentStatus: '运输中',
    events: [
      {
        time: '2026-08-26 09:20',
        location: '上海分拨中心',
        description: '包裹已发出',
      },
      {
        time: '2026-08-26 18:40',
        location: '苏州转运中心',
        description: '包裹运输中',
      },
    ],
  },
  'ORDER-1002': {
    currentStatus: '待发货',
    events: [
      {
        time: '2026-08-27 08:00',
        location: '商家仓库',
        description: '订单已创建，等待发货',
      },
    ],
  },
}

export function findLogistics(raw: string): LogisticsQueryResult {
  const orderId = normalizeOrderId(raw)
  if (!orderId) throw new InvalidOrderIdError()

  const record = LOGISTICS[orderId]
  if (!record) {
    return {
      found: false,
      orderId,
      message: ORDER_NOT_FOUND_MESSAGE,
    }
  }

  return { found: true, orderId, ...record }
}
```

- [ ] **Step 4: 验证 GREEN 和构建**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test tests/logistics.test.mjs
npx -y pnpm@11.7.0 build
```

Expected: 物流业务测试 `5 passed`；构建退出码 `0`；生成 `lib/logistics.js` 和 `lib/logistics.d.ts`。

- [ ] **Step 5: 提交物流业务模块**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
git add examples/dsh-plugin-order-query/src/logistics.ts \
  examples/dsh-plugin-order-query/tests/logistics.test.mjs
git commit -m "feat: add logistics lookup domain"
```

---

### Task 2: 用测试驱动注册 query_logistics

**Files:**

- Modify: `examples/dsh-plugin-order-query/tests/plugin.test.mjs`
- Modify: `examples/dsh-plugin-order-query/src/index.ts`

**Interfaces:**

- Consumes: Task 1 的 `findLogistics(raw: string): LogisticsQueryResult`。
- Produces: 继续可用的 `query_order`，以及参数 `{ orderId: string }`、联合嵌套输出和多行中文渲染组成的 `query_logistics`。

- [ ] **Step 1: 把插件测试桩改为收集全部工具**

用以下辅助函数替换现有 `loadPlugin()`：

```js
function loadPlugin() {
  const tools = new Map()
  const ctx = {
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
  }

  apply(ctx)
  return tools
}

function loadTool(toolName) {
  const tool = loadPlugin().get(toolName)
  if (!tool) throw new Error(`tool not registered: ${toolName}`)
  return tool
}
```

把原有测试中的每个 `const tool = loadPlugin()` 改为：

```js
const tool = loadTool('query_order')
```

把第一个注册测试的开头改为：

```js
const tools = loadPlugin()
const tool = tools.get('query_order')

expect([...tools.keys()]).toEqual(['query_order', 'query_logistics'])
```

- [ ] **Step 2: 追加失败的物流工具测试**

在 `plugin.test.mjs` 的 `describe` 内追加：

```js
it('compiles a strict nested logistics output schema', () => {
  const tool = loadTool('query_logistics')
  const [found, notFound] = tool.output.schema.oneOf
  const event = found.properties.events.items

  expect(tool.parameters.required).toEqual(['orderId'])
  expect(found.properties.found).toEqual({ type: 'boolean', const: true })
  expect(found.additionalProperties).toBe(false)
  expect(event).toMatchObject({
    type: 'object',
    additionalProperties: false,
    required: ['time', 'location', 'description'],
  })
  expect(notFound.properties.found).toEqual({ type: 'boolean', const: false })
  expect(notFound.additionalProperties).toBe(false)
})

it('returns and renders tracking events for ORDER-1001', async () => {
  const tool = loadTool('query_logistics')
  const result = await tool.execute({ orderId: 'order-1001' })

  expect(result).toEqual({
    found: true,
    orderId: 'ORDER-1001',
    currentStatus: '运输中',
    events: [
      {
        time: '2026-08-26 09:20',
        location: '上海分拨中心',
        description: '包裹已发出',
      },
      {
        time: '2026-08-26 18:40',
        location: '苏州转运中心',
        description: '包裹运输中',
      },
    ],
  })
  expect(tool.output.render({}, result)).toEqual([
    {
      type: 'text',
      text: [
        '订单 ORDER-1001 当前物流状态：运输中。',
        '2026-08-26 09:20｜上海分拨中心｜包裹已发出',
        '2026-08-26 18:40｜苏州转运中心｜包裹运输中',
      ].join('\n'),
    },
  ])
})

it('returns and renders the pending shipment event', async () => {
  const tool = loadTool('query_logistics')
  const result = await tool.execute({ orderId: 'ORDER-1002' })

  expect(result.currentStatus).toBe('待发货')
  expect(result.events).toEqual([
    {
      time: '2026-08-27 08:00',
      location: '商家仓库',
      description: '订单已创建，等待发货',
    },
  ])
  expect(tool.output.render({}, result)[0].text).toBe(
    '订单 ORDER-1002 当前物流状态：待发货。\n' +
      '2026-08-27 08:00｜商家仓库｜订单已创建，等待发货',
  )
})

it('returns and renders a normal logistics not-found result', async () => {
  const tool = loadTool('query_logistics')
  const result = await tool.execute({ orderId: 'unknown-001' })

  expect(result).toEqual({
    found: false,
    orderId: 'UNKNOWN-001',
    message: '未找到该订单，请检查订单号。',
  })
  expect(tool.output.render({}, result)).toEqual([
    { type: 'text', text: '未找到订单 UNKNOWN-001，请检查订单号。' },
  ])
})

it('validates logistics arguments and preserves blank input errors', async () => {
  const tool = loadTool('query_logistics')

  await expect(tool.execute({})).rejects.toMatchObject({
    name: 'ToolArgsError',
    message: 'invalid arguments: missing required property "orderId"',
  })
  await expect(tool.execute({ orderId: '   ' })).rejects.toThrow(
    '订单号不能为空。',
  )
})
```

- [ ] **Step 3: 运行插件测试并确认 RED**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test tests/plugin.test.mjs
```

Expected: 原有订单工具断言仍通过；注册测试和新增物流测试因 `query_logistics` 尚未注册而失败。

- [ ] **Step 4: 在 index.ts 声明物流输出 Schema**

导入物流查询函数：

```ts
import { findLogistics } from './logistics.js'
```

在 `ORDER_RESULT_SCHEMA` 后新增：

```ts
const LOGISTICS_RESULT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', const: true, required: true },
        orderId: { type: 'string', required: true },
        currentStatus: { type: 'string', required: true },
        events: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              time: { type: 'string', required: true },
              location: { type: 'string', required: true },
              description: { type: 'string', required: true },
            },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', const: false, required: true },
        orderId: { type: 'string', required: true },
        message: {
          type: 'string',
          const: ORDER_NOT_FOUND_MESSAGE,
          required: true,
        },
      },
    },
  ],
} as const
```

- [ ] **Step 5: 在 apply() 中注册物流工具**

保留现有 `query_order` 注册，在它之后增加：

```ts
ctx.tools.register(
  defineTool({
    name: 'query_logistics',
    description: '根据订单号查询当前物流状态和物流轨迹。',
    parameters: {
      orderId: {
        type: 'string',
        required: true,
        description: '需要查询物流轨迹的订单号，例如 ORDER-1001。',
      },
    },
    output: {
      schema: LOGISTICS_RESULT_SCHEMA,
      render: (_args, value) => {
        if (!value.found) {
          return [
            {
              type: 'text',
              text: `未找到订单 ${value.orderId}，请检查订单号。`,
            },
          ]
        }

        const lines = [
          `订单 ${value.orderId} 当前物流状态：${value.currentStatus}。`,
          ...value.events.map(
            (event) =>
              `${event.time}｜${event.location}｜${event.description}`,
          ),
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        return findLogistics(args.orderId)
      } catch (error) {
        if (error instanceof InvalidOrderIdError) throw error
        throw new Error('物流查询服务暂时不可用，请稍后重试。', {
          cause: error,
        })
      }
    },
  }),
)
```

- [ ] **Step 6: 运行全量测试和构建**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test
npx -y pnpm@11.7.0 build
```

Expected: `3` 个测试文件、`22` 个测试全部通过；构建退出码 `0`。

- [ ] **Step 7: 提交双工具适配层**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
git add examples/dsh-plugin-order-query/src/index.ts \
  examples/dsh-plugin-order-query/tests/plugin.test.mjs
git commit -m "feat: register logistics query tool"
```

---

### Task 3: 更新文档并完成端到端验收

**Files:**

- Modify: `examples/dsh-plugin-order-query/README.md`
- Verify only: `/Users/mac/.dsh/profiles/web` 和 `http://127.0.0.1:3080/`

**Interfaces:**

- Consumes: Task 2 的两个工具和现有 Bundle 节点。
- Produces: 与实际行为一致的双工具说明，以及已知订单、未知订单和原有订单查询的 Web 验收证据。

- [ ] **Step 1: 在 README 中补充第二个工具和轨迹示例**

把开头说明改为：

```markdown
这是一个用于学习 DeepSeek Harness 的客服订单插件。它注册两个只读工具：`query_order` 查询订单状态，`query_logistics` 查询物流轨迹；两个工具都返回结构化结果，再由 Harness 渲染为中文客服文本。
```

在文件职责中增加：

```markdown
- `src/logistics.ts`：纯物流业务模块，复用订单号规则但不依赖 Harness。
- `tests/logistics.test.mjs`：验证两条模拟轨迹、标准化、未找到和空输入。
```

在模拟订单表之后增加：

```markdown
## 物流轨迹工具

`query_logistics` 与 `query_order` 使用相同的 `orderId`，但返回 `currentStatus` 和 `events` 数组。`ORDER-1001` 有上海、苏州两个轨迹节点；`ORDER-1002` 有一条商家仓库待发货节点。

```text
订单 ORDER-1001 当前物流状态：运输中。
2026-08-26 09:20｜上海分拨中心｜包裹已发出
2026-08-26 18:40｜苏州转运中心｜包裹运输中
```
```

把测试成功数量更新为 `22 passed`，并在 Web UI 验证部分追加：

```text
必须调用 query_logistics 工具查询订单 order-1001 的物流轨迹，只返回工具结果。
```

预期为上面的三行轨迹文本。再验证：

```text
必须调用 query_logistics 工具查询订单 unknown-001 的物流轨迹，只返回工具结果。
```

预期为 `未找到订单 UNKNOWN-001，请检查订单号。`。

- [ ] **Step 2: 重新运行全量自动验证**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 test
npx -y pnpm@11.7.0 build
```

Expected: `22 passed`，构建退出码 `0`。

- [ ] **Step 3: 提交 README**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
git add examples/dsh-plugin-order-query/README.md
git commit -m "docs: explain logistics query tool"
```

- [ ] **Step 4: 安装到 web Profile 并重启服务**

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile web add .
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile web --dump-config
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
```

Expected: 最终配置仍包含单个 `dsh-plugin-order-query` / `order-query-tool` 节点；服务监听 `127.0.0.1:3080`。

- [ ] **Step 5: 在 Web UI 验证三个路径**

分别在新会话发送：

```text
必须调用 query_order 工具查询订单 order-1001，只返回工具结果。
```

```text
必须调用 query_logistics 工具查询订单 order-1001 的物流轨迹，只返回工具结果。
```

```text
必须调用 query_logistics 工具查询订单 unknown-001 的物流轨迹，只返回工具结果。
```

Expected: 轨迹依次显示 `query_order`、`query_logistics`、`query_logistics`；返回值分别为原订单状态文本、三行物流轨迹、正常未找到文本。

- [ ] **Step 6: 合并并恢复主工作区运行环境**

在功能分支完成全量验证后：

1. 快进合并到 `main`。
2. 在主工作区重新运行 `npx -y pnpm@11.7.0 test` 和 `build`。
3. 从主工作区重新执行 `dsh plugin --profile web add .`，确认 Profile 符号链接指向主工作区。
4. 停止 Worktree 中的 Web 服务，清理 Worktree 和功能分支。
5. 从主工作区重新启动 Web 服务，并用 `curl` 验证 HTTP 200。
6. 最终 `git status --short` 必须为空。

---

## Completion Evidence

1. `orders.test.mjs` 的 5 个既有测试通过。
2. `logistics.test.mjs` 的 5 个新业务测试通过。
3. `plugin.test.mjs` 的 12 个双工具测试通过。
4. TypeScript 构建成功并生成物流声明和 JavaScript。
5. Web UI 中原 `query_order` 零回归。
6. `query_logistics` 已知订单真实返回两条轨迹。
7. `query_logistics` 未知订单保持成功工具状态并返回未找到提示。
8. 功能合并到 `main`，Web Profile 指向主工作区，临时 Worktree/分支已清理。
