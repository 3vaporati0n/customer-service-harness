# Order Logistics Query 物流轨迹扩展设计

日期：2026-08-27

## 1. 背景与目标

`dsh-plugin-order-query` 已经提供 `query_order`，可以查询订单状态、物流概况和预计送达日期。本次在同一个插件中新增独立工具 `query_logistics`，用于按订单号返回结构化物流轨迹。

新增独立工具而不扩充 `query_order`，目的是让两个工具保持单一职责：

- `query_order` 回答“订单现在是什么状态”。
- `query_logistics` 回答“包裹经过了哪些节点”。

目标行为：

- 保留 `query_order` 的名称、输入、输出和文案，不破坏已有功能。
- 新增 `query_logistics`，接收必填字符串参数 `orderId`。
- 复用现有订单号标准化规则：`trim().toUpperCase()`。
- 已知订单返回当前物流状态和按时间正序排列的轨迹事件数组。
- 未知非空订单返回结构化 `found: false`，不抛异常。
- 空订单号继续抛出 `订单号不能为空。`。
- 使用 `oneOf`、布尔 `const`、严格对象和嵌套数组 Schema 校验工具输出。
- 将结构化轨迹渲染为易读的中文多行文本。

不在本次范围内：

- 不连接真实物流公司 API、数据库或网络服务。
- 不实现地图、轨迹可视化或地理坐标。
- 不实现物流公司选择、运单号查询或分页。
- 不修改订单状态数据的业务含义。
- 不合并 `query_order` 和 `query_logistics`。

## 2. 方案选择

采用“同一插件、独立工具、独立业务模块”方案：

```text
src/
├── orders.ts       订单状态与共享订单号规则
├── logistics.ts    物流类型、模拟轨迹和查询逻辑
└── index.ts        注册 query_order 与 query_logistics
```

该方案比直接扩大 `query_order` 更容易让模型按问题选择工具，也避免每次订单查询都返回不需要的轨迹数组。与给 `query_order` 增加 `includeTracking` 参数相比，它的输入和输出分支更简单，测试边界更清楚。

`logistics.ts` 不导入 Harness，只从 `orders.ts` 复用 `normalizeOrderId()`、`InvalidOrderIdError` 和统一的未找到提示。首版不再拆出第三个共享模块，避免为三个小型符号增加额外文件。

## 3. 组件与接口

### 3.1 物流事件

```ts
export interface LogisticsEvent {
  readonly time: string
  readonly location: string
  readonly description: string
}
```

事件按 `time` 从早到晚排列。首版时间使用稳定的展示字符串，不进行时区换算或日期解析。

### 3.2 查询结果

```ts
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
```

业务模块导出：

```ts
export function findLogistics(raw: string): LogisticsQueryResult
```

### 3.3 Harness 工具

新工具固定为：

```text
名称：query_logistics
参数：orderId，必填字符串
说明：根据订单号查询当前物流状态和物流轨迹。
```

插件继续导出：

```ts
name = 'order-query'
inject = ['tools']
apply(ctx: Context)
```

`apply()` 在同一个 `tools` 服务中分别注册 `query_order` 和 `query_logistics`。

## 4. 模拟物流数据

`ORDER-1001`：

```json
{
  "currentStatus": "运输中",
  "events": [
    {
      "time": "2026-08-26 09:20",
      "location": "上海分拨中心",
      "description": "包裹已发出"
    },
    {
      "time": "2026-08-26 18:40",
      "location": "苏州转运中心",
      "description": "包裹运输中"
    }
  ]
}
```

`ORDER-1002`：

```json
{
  "currentStatus": "待发货",
  "events": [
    {
      "time": "2026-08-27 08:00",
      "location": "商家仓库",
      "description": "订单已创建，等待发货"
    }
  ]
}
```

轨迹记录在 `logistics.ts` 内存常量中，与 `orders.ts` 中的两个已知订单保持一致。

## 5. 输出 Schema

`query_logistics` 使用 `oneOf` 描述两个互斥分支。

成功分支：

- `found` 是 `const: true`。
- `orderId`、`currentStatus` 和 `events` 必填。
- `events` 是数组，数组元素是严格对象。
- 每个事件必须包含 `time`、`location` 和 `description`。
- 成功对象和事件对象都设置 `additionalProperties: false`。

未找到分支：

- `found` 是 `const: false`。
- `orderId` 和 `message` 必填。
- `message` 固定为 `ORDER_NOT_FOUND_MESSAGE`。
- 设置 `additionalProperties: false`。

TypeScript 联合类型提供开发期约束，Harness 输出 Schema 提供运行期约束。嵌套事件 Schema 可以阻止缺少时间、地点或描述的轨迹进入模型上下文。

## 6. 数据流与渲染

```text
用户说“查询 order-1001 的物流轨迹”
  -> 模型选择 query_logistics({ orderId: "order-1001" })
  -> 参数 Schema 校验 orderId 是字符串
  -> findLogistics() 标准化为 ORDER-1001
  -> 查询内存物流记录
  -> 返回 found: true 和 events
  -> output.oneOf 校验嵌套结构
  -> render() 生成中文多行文本
```

成功渲染精确为：

```text
订单 ORDER-1001 当前物流状态：运输中。
2026-08-26 09:20｜上海分拨中心｜包裹已发出
2026-08-26 18:40｜苏州转运中心｜包裹运输中
```

未找到渲染精确为：

```text
未找到订单 UNKNOWN-001，请检查订单号。
```

`render()` 只负责展示，不修改规范结果，也不重新查询业务数据。

## 7. 错误边界

```text
有效订单号 + 有物流记录
  -> found: true

有效订单号 + 无物流记录
  -> found: false

标准化后为空
  -> InvalidOrderIdError("订单号不能为空。")

意外内部异常
  -> Error("物流查询服务暂时不可用，请稍后重试。", { cause })
```

未知订单是正常业务结果，不能转换为工具错误。内部异常不能伪装成 `found: false`；适配层保留原始 `cause` 供诊断，同时不在渲染文本中暴露堆栈和内部路径。

## 8. 测试设计

新增 `tests/logistics.test.mjs`，覆盖：

1. `ORDER-1001` 返回两条按时间正序排列的轨迹。
2. `ORDER-1002` 返回待发货状态和一条仓库事件。
3. `" order-1001 "` 正确标准化并命中同一记录。
4. `UNKNOWN-001` 返回统一的未找到结果。
5. 空白订单号抛出 `InvalidOrderIdError` 和固定错误文案。

调整 `tests/plugin.test.mjs`：

1. 测试桩收集全部注册工具，而不是只保存最后一个工具。
2. 证明 `query_order` 继续存在且原有测试全部通过。
3. 证明 `query_logistics` 被注册，参数要求 `orderId`。
4. 验证输出 Schema 的两个 `oneOf` 分支和嵌套事件对象。
5. 验证 `ORDER-1001`、`ORDER-1002` 和未知订单的执行与中文渲染。
6. 验证缺失参数由 `defineTool` 拒绝，空字符串保留业务输入错误。

最终验证：

- `npx -y pnpm@11.7.0 test` 全部通过。
- `npx -y pnpm@11.7.0 build` 成功。
- Web Profile 最终配置仍只加载一个 `dsh-plugin-order-query` Bundle 节点。
- Web UI 可以分别调用 `query_order` 和 `query_logistics`。
- 已知物流查询返回两条轨迹；未知物流查询保持成功工具状态并返回未找到提示。

## 9. 文件变更范围

- Create: `examples/dsh-plugin-order-query/src/logistics.ts`
- Create: `examples/dsh-plugin-order-query/tests/logistics.test.mjs`
- Modify: `examples/dsh-plugin-order-query/src/index.ts`
- Modify: `examples/dsh-plugin-order-query/tests/plugin.test.mjs`
- Modify: `examples/dsh-plugin-order-query/README.md`

不修改 `package.json`、`pnpm-lock.yaml`、`tsconfig.json` 或 `cordis.patch.yml`，因为本功能不增加依赖、构建设置或 Bundle 节点。

## 10. 完成定义

- `query_order` 的现有行为零回归。
- `query_logistics` 的参数、结构化输出和中文渲染与本文档一致。
- 两个模拟订单、未知订单和空订单号均有自动化测试。
- 输出 Schema 严格校验嵌套事件数组。
- 全量测试、构建和 Web UI 双工具验收通过。
- 功能在隔离分支完成，验证后合并回 `main`，并将 Web Profile 链接恢复到主工作区。
