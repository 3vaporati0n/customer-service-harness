# Order Query 客服插件设计

日期：2026-08-26

## 1. 背景与目标

在已经完成的 `dsh-plugin-beginner-greet` 学习插件之后，本阶段新增一个独立的客服场景插件 `dsh-plugin-order-query`。它通过一个只读工具查询内存中的模拟订单，用于学习 DeepSeek Harness 从用户意图、工具选择、参数校验、业务查询、输出校验到文本渲染的完整链路。

目标行为：

- 注册名为 `query_order` 的工具，接收必填字符串参数 `orderId`。
- 查询前对订单号执行 `trim()` 和 `toUpperCase()`。
- 查到订单时返回状态、物流状态和预计送达日期。
- 查不到订单时返回结构化的正常结果，而不是抛出异常。
- 空订单号属于无效输入，应抛出明确错误。
- 使用 TypeScript 联合类型和 Harness 输出 Schema 约束两种合法结果。
- 将结构化结果渲染为清晰的中文客服回复。

不在本次范围内：

- 不连接真实数据库、订单系统或物流 API。
- 不实现身份认证、订单归属校验或多租户隔离。
- 不实现取消订单、退款、修改地址等写操作。
- 不实现物流轨迹列表、分页、缓存、重试或超时策略。
- 不修改已有的 `dsh-plugin-beginner-greet`。

## 2. 方案选择

插件采用“独立业务模块”方案，将 Harness 接入与订单查询逻辑分开：

```text
src/
├── index.ts     Harness 工具定义、注册和渲染
└── orders.ts    类型、模拟数据、标准化和查询逻辑
```

与把所有逻辑写进 `index.ts` 相比，该方案多一个文件，但职责清楚，测试无需依赖 Harness，并且以后可以在不改变工具接口的情况下把内存数据替换为数据库或 HTTP API。与运行时读取 JSON 文件相比，它不增加文件路径和部署依赖，更适合当前教学范围。

## 3. 目录与组件职责

新增目录：

```text
examples/dsh-plugin-order-query/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── cordis.patch.yml
├── README.md
├── src/
│   ├── orders.ts
│   └── index.ts
└── tests/
    ├── orders.test.mjs
    └── plugin.test.mjs
```

各文件职责：

- `src/orders.ts`：导出订单类型、查询结果联合类型、模拟订单数据、`normalizeOrderId()` 和 `findOrder()`。该文件不导入 Harness。
- `src/index.ts`：导出插件元数据和 `apply()`，注册 `query_order`，声明参数与输出 Schema，调用 `findOrder()` 并渲染中文文本。
- `cordis.patch.yml`：声明独立 Bundle 项，ID 为 `order-query-tool`，包名为 `dsh-plugin-order-query`。
- `tests/orders.test.mjs`：验证纯业务规则。
- `tests/plugin.test.mjs`：验证插件元数据、工具注册、执行与渲染。
- `README.md`：说明安装、Bundle 配置、测试、构建和 Web UI 验证方法。

插件导出：

```ts
export const name = 'order-query'
export const inject = ['tools']
```

工具名称固定为 `query_order`，避免与插件包名、Bundle ID 混淆。

## 4. 业务数据与类型

首版提供两条固定的模拟记录：

```text
ORDER-1001
  status: shipped
  logisticsStatus: 运输中
  estimatedDelivery: 2026-08-28

ORDER-1002
  status: processing
  logisticsStatus: 待发货
  estimatedDelivery: 2026-08-30
```

查询结果使用 `found` 作为 TypeScript 可辨识联合类型的判别字段：

```ts
export type OrderQueryResult =
  | {
      found: true
      orderId: string
      status: string
      logisticsStatus: string
      estimatedDelivery: string
    }
  | {
      found: false
      orderId: string
      message: string
    }
```

成功结果示例：

```json
{
  "found": true,
  "orderId": "ORDER-1001",
  "status": "shipped",
  "logisticsStatus": "运输中",
  "estimatedDelivery": "2026-08-28"
}
```

未找到结果示例：

```json
{
  "found": false,
  "orderId": "UNKNOWN-001",
  "message": "未找到该订单，请检查订单号。"
}
```

## 5. 工具接口与输出 Schema

`query_order` 的参数 Schema 要求一个必填字符串 `orderId`。参数 Schema 负责拒绝缺失值和非字符串值，业务层继续负责拒绝经 `trim()` 后为空的字符串。

输出 Schema 使用 `oneOf` 描述两种互斥形状：

1. 成功分支必须包含 `found`、`orderId`、`status`、`logisticsStatus` 和 `estimatedDelivery`，并用 `const: true` 固定 `found`。
2. 未找到分支必须包含 `found`、`orderId` 和 `message`，并用 `const: false` 固定 `found`。
3. 两个对象都设置 `additionalProperties: false`，不接受未声明字段。

TypeScript 联合类型提供开发期检查，Harness Schema 提供运行期检查。两个 `oneOf` 分支通过布尔常量、各自必填字段和禁止额外字段保持互斥；测试还会明确验证编译后的输出 Schema 与实际返回值。

`execute()` 始终返回结构化对象。`render()` 只负责展示，不参与查询或改变规范结果。

成功渲染示例：

```text
订单 ORDER-1001 当前状态：已发货；物流状态：运输中；预计送达时间：2026-08-28。
```

未找到渲染示例：

```text
未找到订单 UNKNOWN-001，请检查订单号。
```

其中业务状态 `shipped` 在展示层映射为“已发货”，结构化返回值仍保留稳定的英文状态码，便于程序消费。

## 6. 数据流

一次成功调用的完整路径是：

```text
用户说“查询 order-1001”
  -> 模型选择 query_order({ orderId: "order-1001" })
  -> 参数 Schema 验证 orderId 是字符串
  -> execute() 委托给 findOrder()
  -> normalizeOrderId() 得到 ORDER-1001
  -> 查询内存模拟数据
  -> 返回 found: true 的结构化结果
  -> output.oneOf 验证结果形状
  -> render() 生成中文客服文本
  -> 模型将工具结果回复给用户
```

Harness 接入层只知道如何注册、校验和展示工具；业务层只知道如何标准化和查询订单。二者通过 `OrderQueryResult` 通信。

## 7. 错误边界

三类结果必须明确区分：

```text
有效订单号 + 查到
  -> 返回 found: true

有效订单号 + 未查到
  -> 返回 found: false

无效输入或系统故障
  -> 抛出异常
```

具体规则：

- `normalizeOrderId(raw)` 执行 `raw.trim().toUpperCase()`。
- 标准化结果为空时抛出 `订单号不能为空。`，不把无效输入伪装成“未找到”。
- 未知但非空的订单号是正常业务结果，返回 `found: false`。
- 意外的内部异常不得转换为 `found: false`。接入层对外抛出 `订单查询服务暂时不可用，请稍后重试。`，并通过异常的 `cause` 保留原始错误供诊断。
- `render()` 不输出堆栈、文件路径、配置或其他内部信息。

当前内存实现没有网络或数据库故障点，但提前固定错误语义，可以防止未来替换数据源时破坏工具契约。

## 8. 测试设计

### 8.1 业务测试

`tests/orders.test.mjs` 覆盖：

1. `ORDER-1001` 返回成功结果及正确字段。
2. `" order-1001 "` 经空格和大小写标准化后返回同一订单。
3. `UNKNOWN-001` 返回 `found: false` 和固定提示。
4. 仅包含空白的订单号抛出 `订单号不能为空。`。

这些测试不启动 Harness，用于证明业务模块可独立工作。

### 8.2 插件集成测试

`tests/plugin.test.mjs` 覆盖：

1. 插件声明 `tools` 依赖。
2. 插件注册名为 `query_order` 的工具。
3. 参数 Schema 将 `orderId` 声明为必填字符串。
4. 执行已知订单返回符合成功分支的结构化结果。
5. 执行未知订单返回符合未找到分支的结构化结果。
6. 成功和未找到结果分别生成准确的中文渲染文本。
7. 空订单号沿工具执行链抛出明确的输入错误。

### 8.3 验收验证

实现完成后必须满足：

- `npx -y pnpm@11.7.0 test` 全部通过。
- `npx -y pnpm@11.7.0 build` 成功。
- Web Profile 能加载 `order-query-tool` Bundle。
- Web UI 查询 `ORDER-1001` 时，模型调用 `query_order` 并返回物流信息。
- Web UI 查询 `UNKNOWN-001` 时，模型调用同一工具并返回未找到提示。
- README 中的命令、示例和实际行为一致。

## 9. 实现约束与完成定义

- 新插件保持独立，不修改问候插件的源码、配置和测试。
- 只使用内存模拟数据，不引入数据库或网络依赖。
- 业务模块不得导入 Harness，接入层不得复制订单查找规则。
- 所有对外字段名称、工具名称和中文提示与本文档保持一致。
- 测试、构建和两种 Web UI 查询全部通过后，功能才算完成。

本设计的核心学习链路是：

```text
用户意图
  -> 模型选择工具
  -> 输入 Schema
  -> 独立业务函数
  -> 联合类型结果
  -> output.oneOf
  -> render()
  -> 客服回复
```
