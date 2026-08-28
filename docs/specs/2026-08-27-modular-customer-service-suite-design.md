# Modular Customer Service Suite 模块化客服能力套件设计

日期：2026-08-27

## 1. 背景与目标

当前仓库已经有 `dsh-plugin-order-query`，提供 `query_order` 和
`query_logistics` 两个只读工具。下一阶段不再以教学示例为目标，而是建设一套可以持续修改、独立测试、按需启停并一键组合部署的电商客服能力套件。

目标能力分为三类：

1. 查询类：订单、物流、库存。
2. 售后类：取消订单、退货、退款、修改地址。
3. 主动服务类：异常物流提醒、商品补货提醒、包裹送达提醒、退款进度提醒。

本设计的核心约束是：每个业务功能都是独立插件，共享状态、事件、确认和审计能力通过稳定 Service 接口提供；聚合 Bundle 负责一键安装整套功能，但任何单一插件都可以单独修改、测试、替换或停用。

首版继续使用内存模拟数据，不连接真实商城、物流、库存、支付、短信或邮件平台。主动提醒通过 DeepSeek Harness 当前会话发送。

## 2. 范围与非目标

### 2.1 本次范围

- 保留现有 `query_order` 和 `query_logistics` 的工具名称与参数；`ORDER-1001`、`ORDER-1002` 在未发生写操作时继续返回现有结果和中文文案。为支持售后状态，`query_order` 的成功分支以向后兼容方式新增 `delivered` 和 `cancelled` 状态。
- 新增库存查询。
- 为取消订单、退货、退款和修改地址实现资格预检、一次性确认和执行。
- 为物流异常、商品补货、包裹送达和退款状态变化实现会话订阅与主动提醒。
- 实现提醒订阅查询和取消。
- 实现统一的内存状态、领域事件、确认编号、幂等和审计服务。
- 实现正式聚合 Bundle 和带模拟事件工具的演示 Bundle。
- 实现一键验证、打包和安装命令。

### 2.2 非目标

- 不连接真实电商、物流、仓储、支付或 CRM API。
- 不实现数据库持久化；进程重启后模拟状态、订阅和确认记录清空。
- 不发送真实短信、邮件、微信或 App Push。
- 不实现客服工作台 UI、报表、知识库、FAQ、语音或多渠道接入。
- 不实现真实身份认证、客户数据隔离或多租户授权；首版模拟数据按显式业务编号访问。
- 不由模型自由决定业务资格、异常类型或退款金额。
- 不在没有用户确认的情况下执行取消、退货、退款或地址修改。
- 不删除现有 `dsh-plugin-order-query`；它保留为已完成基线，新的模块化插件成为后续扩展的规范实现。

## 3. 交付分解

整套能力包含多个独立子系统，按依赖顺序分阶段交付：

1. **平台与查询阶段**：共享 domain/state/event/approval 服务、模块化订单与物流查询、库存查询、生产和演示 Bundle 骨架。
2. **售后阶段**：取消、退货、退款和修改地址四个独立插件。
3. **主动服务阶段**：异常物流、补货、送达和退款进度提醒，以及提醒管理。
4. **整体验收阶段**：模拟事件、全链路 Web 验收、一键打包安装和迁移 Web Profile。

每个阶段有独立实施计划和验收门禁。后续阶段只能依赖已经验收的公开接口，不能读取前序插件内部状态。

## 4. 仓库结构

```text
examples/dsh-customer-service-suite/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── packages/
│   ├── customer-domain/
│   ├── customer-state/
│   ├── customer-events/
│   └── customer-approval/
├── plugins/
│   ├── query-order/
│   ├── query-logistics/
│   ├── query-inventory/
│   ├── cancel-order/
│   ├── return-order/
│   ├── refund-order/
│   ├── change-address/
│   ├── logistics-anomaly-alert/
│   ├── product-restock-alert/
│   ├── delivery-alert/
│   ├── refund-progress-alert/
│   ├── alert-management/
│   └── mock-operations/
├── bundles/
│   ├── customer-service-suite/
│   └── customer-service-demo/
├── scripts/
└── tests/
```

每个功能插件固定拥有独立的：

```text
src/
tests/
README.md
package.json
tsconfig.json
cordis.patch.yml
```

### 4.1 共享包

`customer-domain`：

- 只包含 TypeScript 类型、错误代码、状态枚举、业务常量和纯函数。
- 不依赖 Harness、Cordis 或具体存储。
- 是所有模块的共同语言，但不保存可变状态。

`customer-state`：

- 提供 `customerState` Service。
- 独占内存实体和实体级写锁。
- 对外暴露查询、事务性修改、版本检查和测试种子接口。
- 内部 `Map` 不导出，业务插件不能绕过 Service。

`customer-events`：

- 提供 `customerEvents` Service。
- 接收状态提交后产生的版本化领域事件。
- 提醒插件按提醒类型注册事件匹配器；状态生产者只发布事件，不导入或识别具体提醒插件。
- 保存提醒订阅、投递结果和事件去重标记。
- 解析订阅绑定的实时 Agent，并通过 `agent.followup()` 向原会话发送提醒。

`customer-approval`：

- 提供 `customerApproval` Service。
- 创建、校验和消费一次性 `confirmationId`。
- 保存幂等执行结果和审计记录。
- 不包含取消、退款等具体业务规则。

共享包的准确 npm 名称为：

| 目录 | 包名 | 形态 |
|---|---|---|
| `customer-domain` | `@dsh-customer-service/domain` | 纯 TypeScript 库 |
| `customer-state` | `@dsh-customer-service/state` | Cordis Service 插件 |
| `customer-events` | `@dsh-customer-service/events` | Cordis Service 插件 |
| `customer-approval` | `@dsh-customer-service/approval` | Cordis Service 与工具批准守卫 |

功能插件包名统一为 `dsh-plugin-customer-<目录名>`，例如退款插件是
`dsh-plugin-customer-refund-order`。生产和演示 Bundle 包名分别是
`dsh-bundle-customer-service-suite` 和 `dsh-bundle-customer-service-demo`。

### 4.2 功能插件

每个功能插件只注册自己的工具，只依赖共享 Service 的公开接口。禁止功能插件彼此直接导入源码。

### 4.3 Bundle

`customer-service-suite`：

- 生产组合层。
- 加载共享 Service、全部查询、售后、提醒和提醒管理插件。
- 不加载模拟运营工具。

`customer-service-demo`：

- 在生产 Bundle 基础上增加 `mock-operations`。
- 仅用于本地开发、自动化测试和 Web 验收。
- 允许受控模拟库存、物流、退款和时钟变化。

## 5. 工具目录与权限

### 5.1 查询工具

| 插件 | 工具 | 输入 | 行为 |
|---|---|---|---|
| `query-order` | `query_order` | `orderId: string` | 查询订单状态，保持现有契约 |
| `query-logistics` | `query_logistics` | `orderId: string` | 查询物流状态和轨迹，保持现有契约 |
| `query-inventory` | `query_inventory` | `sku: string` | 查询商品名称、库存数量和是否有货 |

查询工具是只读工具，可以声明并发安全；它们不能修改订阅或业务状态。

`query_order` 的成功状态枚举扩展为
`shipped | processing | delivered | cancelled`，新增中文标签分别为“已签收”和“已取消”。
现有两个模拟订单在任何写操作发生前继续产生当前基线的精确文本。

### 5.2 售后工具

| 插件 | 预检工具 | 确认工具 |
|---|---|---|
| `cancel-order` | `request_cancel_order` | `confirm_cancel_order` |
| `return-order` | `request_return_order` | `confirm_return_order` |
| `refund-order` | `request_refund` | `confirm_refund` |
| `change-address` | `request_address_change` | `confirm_address_change` |

固定参数：

- `request_cancel_order({ orderId, reason })`
- `request_return_order({ orderId, reason })`
- `request_refund({ orderId, reason })`
- `request_address_change({ orderId, newAddress })`
- 所有 `confirm_*` 工具只接收 `{ confirmationId }`。

首版取消、退货和退款均作用于整张订单，不支持部分商品、部分数量或用户指定退款金额。退款金额由订单总额派生。地址使用一个完整展示字符串，不在首版拆分省市区和联系人字段。

预检工具：

- 读取最新状态并执行确定性资格规则。
- 资格不通过时返回结构化拒绝结果，不抛工具异常。
- 资格通过时创建 10 分钟有效的一次性确认编号。
- 创建确认记录不属于订单业务状态修改。

确认工具：

- 再次读取最新状态并重新执行资格检查。
- 校验确认编号的操作类型、目标和参数快照。
- 获取实体级写锁后提交状态变化。
- 写入审计记录和幂等结果。
- 是高风险写工具，由 Harness 批准策略再次拦截。

`customer-approval` 在 `tools/pre-execute` 注册批准守卫：工具名精确匹配
`confirm_cancel_order`、`confirm_return_order`、`confirm_refund` 或
`confirm_address_change` 时返回 `ask`，其他工具继续使用已有策略。守卫只负责 Harness
交互批准；一次性 `confirmationId` 仍由售后业务流程验证，两者不能互相替代。

### 5.3 主动服务工具

| 插件 | 工具 | 输入 |
|---|---|---|
| `logistics-anomaly-alert` | `check_logistics_anomaly` | `orderId` |
| `logistics-anomaly-alert` | `subscribe_logistics_anomaly_alert` | `orderId` |
| `product-restock-alert` | `subscribe_product_restock_alert` | `sku` |
| `delivery-alert` | `subscribe_delivery_alert` | `orderId` |
| `refund-progress-alert` | `subscribe_refund_progress_alert` | `refundId` |
| `alert-management` | `list_alert_subscriptions` | 无 |
| `alert-management` | `cancel_alert_subscription` | `subscriptionId` |

订阅工具从 `ToolRunContext.agent.id` 获取当前会话标识，不接受模型提供的 `sessionId`。没有 Agent 的直接调用返回固定业务拒绝：`ALERT_SESSION_REQUIRED`。

订阅成功统一返回：

```ts
interface AlertSubscriptionResult {
  subscribed: true
  subscriptionId: string
  targetType: 'order' | 'product' | 'refund'
  targetId: string
}
```

对同一会话、提醒类型和目标重复订阅是幂等操作，返回已有的活动订阅。

### 5.4 模拟运营工具

`mock-operations` 只存在于演示 Bundle，提供受控状态迁移：

- `mock_set_inventory({ sku, stock })`
- `mock_append_logistics_event({ orderId, status, time, location, description })`
- `mock_update_refund_status({ refundId, status })`
- `mock_advance_clock({ hours })`

这些工具用于触发提醒和验证超时规则，不进入生产 Bundle。它们的写操作仍使用 `customerState`，不能直接修改内部 `Map`，并由演示 Bundle 的批准守卫统一返回 `ask`；模拟工具不使用售后确认编号。

## 6. 共享数据模型

### 6.1 Order

```ts
type OrderStatus = 'processing' | 'shipped' | 'delivered' | 'cancelled'

interface Order {
  orderId: string
  customerId: string
  status: OrderStatus
  address: string
  estimatedDelivery: string
  items: Array<{ sku: string; quantity: number; unitPrice: number }>
  totalAmount: number
  createdAt: string
  deliveredAt?: string
  version: number
}
```

`estimatedDelivery` 保留现有 `query_order` 的公开预计送达日期；物流中文状态从同一订单的
`Logistics.currentStatus` 派生，不在 `Order` 中保存第二份可变状态。

### 6.2 Inventory

```ts
interface Inventory {
  sku: string
  productName: string
  stock: number
  updatedAt: string
  version: number
}
```

库存不能小于零。`inStock` 是 `stock > 0` 的派生值，不作为第二份可变状态保存。

### 6.3 Logistics

```ts
type LogisticsStatus =
  | 'pending_shipment'
  | 'in_transit'
  | 'delivered'
  | 'delivery_failed'

interface LogisticsEvent {
  time: string
  location: string
  description: string
}

interface Logistics {
  orderId: string
  status: LogisticsStatus
  currentStatus: string
  events: LogisticsEvent[]
  updatedAt: string
  version: number
}
```

`query_logistics` 继续返回现有 `currentStatus` 和 `events`，内部新增的状态代码不改变现有公开结果。

### 6.4 ReturnRequest

```ts
type ReturnStatus = 'approved' | 'received' | 'rejected'

interface ReturnRequest {
  returnId: string
  orderId: string
  reason: string
  status: ReturnStatus
  createdAt: string
  version: number
}
```

首版资格通过并确认后直接创建 `approved` 退货记录；收货状态只能由模拟运营工具或未来真实仓储适配器更新。

### 6.5 Refund

```ts
type RefundStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

interface Refund {
  refundId: string
  orderId: string
  returnId?: string
  amount: number
  reason: string
  status: RefundStatus
  updatedAt: string
  version: number
}
```

确认退款后创建 `pending` 记录。后续进度由模拟运营工具或未来支付适配器更新。

### 6.6 Confirmation 与审计

```ts
type CustomerAction =
  | 'cancel_order'
  | 'return_order'
  | 'refund_order'
  | 'change_address'

interface ActionConfirmation {
  confirmationId: string
  action: CustomerAction
  targetId: string
  payload: object
  createdAt: string
  expiresAt: string
  consumedAt?: string
  auditId?: string
}

interface AuditRecord {
  auditId: string
  action: CustomerAction
  targetId: string
  before: object
  after: object
  occurredAt: string
}
```

确认记录保存经过规范化和深冻结的参数快照。审计记录不保存模型思考、系统提示、API Key 或其他秘密。

### 6.7 提醒订阅

```ts
type AlertType =
  | 'logistics_anomaly'
  | 'product_restock'
  | 'delivery'
  | 'refund_progress'

interface AlertSubscription {
  subscriptionId: string
  sessionId: string
  alertType: AlertType
  targetId: string
  active: boolean
  createdAt: string
  lastTriggeredVersion?: number
  lastTriggeredFingerprint?: string
}
```

普通状态提醒使用 `lastTriggeredVersion`；异常物流订阅还保存规范化异常代码集合的
`lastTriggeredFingerprint`。时钟多次前进但异常集合没有变化时，不重复发送相同提醒。

### 6.8 初始模拟数据

演示时钟固定从 `2026-08-27 12:00` 开始，初始状态至少包含：

| 标识 | 初始状态 | 用途 |
|---|---|---|
| `ORDER-1001` | `shipped` / `in_transit` | 保留现有订单和两条物流轨迹查询结果 |
| `ORDER-1002` | `processing` / `pending_shipment` | 取消订单、修改地址和未发货超时流程 |
| `ORDER-1003` | `delivered`，签收时间 `2026-08-26 10:00` | 退货和退款流程 |
| `SKU-1001` | 商品“无线鼠标”，库存 `12` | 有货查询 |
| `SKU-1002` | 商品“机械键盘”，库存 `0` | 补货订阅和提醒 |

`ORDER-1001` 和 `ORDER-1002` 的公开字段及既有物流事件保持当前基线。初始不存在退货、退款、确认、订阅或审计记录；测试各自创建所需状态，不能共享可变夹具。

## 7. 领域事件与提醒投递

状态事务提交成功后发布以下事件：

- `order.updated`
- `inventory.changed`
- `logistics.updated`
- `return.updated`
- `refund.updated`
- `clock.advanced`（仅演示 Bundle，用于重新计算基于时间的异常订阅）

统一事件信封：

```ts
interface CustomerDomainEvent {
  eventId: string
  type: string
  entityId: string
  version: number
  occurredAt: string
  payload: object
}
```

事件流：

```text
状态插件获取实体级锁
  -> 校验旧版本和业务规则
  -> 提交新状态并递增 version
  -> 释放状态事务
  -> 发布领域事件
  -> 提醒插件筛选活动订阅
  -> subscriptionId + eventId 去重
  -> 解析订阅对应的实时 Agent
  -> agent.followup() 向原会话排队一条插件来源消息
  -> 保存 delivered 或 delivery_failed 投递结果
```

状态提交与事件发布保持固定顺序：失败修改不能产生提醒。提醒投递失败不能回滚已经成功的业务状态。

当 Agent 正忙时，`followup()` 排队到独立后续轮次；不向当前模型步骤强行注入异步内容。当 Agent 已销毁或会话不存在时记录 `DELIVERY_FAILED`。由于首版是内存实现，不跨进程重试。

## 8. 业务规则

### 8.1 标识规范化

- 订单号、SKU、退款编号和确认编号统一执行 `trim().toUpperCase()`。
- 规范化后为空返回固定输入错误。
- 客户不能在工具参数中指定或覆盖当前 `sessionId`。

### 8.2 异常物流

`check_logistics_anomaly` 使用可注入时钟和三条确定性规则：

1. `NOT_SHIPPED_TIMEOUT`：订单仍处于 `processing`，且从 `createdAt` 起超过 48 小时。
2. `TRACKING_STALE`：物流处于 `in_transit`，且最新轨迹距当前时钟超过 24 小时。
3. `DELIVERY_FAILURE`：内部状态为 `delivery_failed`，或最新轨迹描述包含“配送失败”“地址异常”“包裹滞留”。

前两类严重程度为 `warning`，配送失败为 `critical`。若同一订单同时命中多条规则，结果返回按以上顺序排列的异常数组，不由模型选择或合并。

阈值是插件配置，默认值固定为 48 小时和 24 小时；测试通过假时钟前进，不等待真实时间。

### 8.3 售后资格

- `processing` 订单可以取消和修改地址。
- `shipped`、`delivered` 或 `cancelled` 订单不能取消或修改地址。
- `delivered` 订单在 `deliveredAt` 后 7 个自然日内可以申请整单退货。
- 同一订单最多存在一个活动退货记录。
- 退款必须关联已取消订单，或关联状态为 `approved`/`received` 的退货记录。
- 同一订单最多存在一个未失败退款。
- 退款金额始终等于订单 `totalAmount`，模型和用户不能传入金额。

业务拒绝返回固定代码，例如：

- `ORDER_NOT_FOUND`
- `ORDER_ALREADY_SHIPPED`
- `ORDER_NOT_DELIVERED`
- `RETURN_WINDOW_EXPIRED`
- `RETURN_ALREADY_EXISTS`
- `REFUND_NOT_ELIGIBLE`
- `REFUND_ALREADY_EXISTS`

### 8.4 确认与幂等

- `confirmationId` 默认 10 分钟过期。
- 确认编号绑定操作、目标和规范化参数快照。
- 确认时再次运行资格规则；状态已经变化时返回新的拒绝原因。
- 首次成功执行保存 `auditId` 和规范结果。
- 同一确认编号重复执行不再次修改状态，返回原结果并设置 `alreadyApplied: true`。
- 过期、操作不匹配和参数不匹配分别返回固定错误代码，不共享模糊文案。

### 8.5 主动提醒条件

- 异常物流：订单首次命中异常，或异常集合随物流版本发生变化时提醒。
- 时钟前进：演示时钟发布 `clock.advanced`，异常物流插件重新计算活动订阅；即使没有新物流事件，超过 24/48 小时阈值也能触发一次提醒。
- 商品补货：库存从 `0` 变为大于 `0` 时提醒。
- 包裹送达：物流从非 `delivered` 变为 `delivered` 时提醒。
- 退款进度：退款 `status` 每次发生真实变化时提醒。
- 普通状态订阅对同一实体版本最多投递一次；异常物流订阅仅在规范化异常指纹发生变化时投递。
- 提醒订阅目标必须在创建时存在；未知订单、SKU 或退款编号返回结构化业务拒绝。
- `list_alert_subscriptions` 只列出当前 `exec.agent.id` 的订阅，`cancel_alert_subscription` 也只能取消当前会话拥有的订阅。

## 9. 错误边界

错误分为四层：

1. **Schema 参数错误**：缺少字段、类型错误和额外字段由 `defineTool` 拒绝。
2. **正常业务拒绝**：未找到、资格不足、无异常或无库存作为结构化成功结果返回。
3. **确认错误**：过期、已失效、参数不匹配和状态冲突使用固定确认错误代码。
4. **内部异常**：适配层返回安全中文错误，并在 `Error.cause` 保留原始异常。

统一拒绝形状：

```ts
interface RejectedResult {
  accepted: false
  code: string
  message: string
}
```

统一重复确认形状包含：

```ts
{
  applied: true,
  alreadyApplied: true,
  auditId: string
}
```

共享服务关闭、Agent 消失或提醒投递失败不能暴露内部路径、堆栈或用户配置。

## 10. 并发、权限与安全

- 查询工具在底层查询方法纯只读时可以声明并发安全。
- 写工具、订阅工具和模拟运营工具默认独占执行。
- `customer-state` 按 `orderId`、`sku` 或 `refundId` 提供实体级锁。
- 售后确认工具经过两层批准：一次性业务确认编号和 Harness 高风险批准策略。
- 订阅与取消订阅是可逆低风险操作，不需要售后确认编号。
- 模拟运营插件不进入生产 Bundle。
- 所有输出 Schema 使用严格对象、必填字段和 `additionalProperties: false`。
- 不在工具结果、审计记录或提醒消息中保存凭据。

## 11. 测试策略

### 11.1 模块测试

每个共享包和功能插件拥有独立测试：

- 领域规则和边界值。
- Service 公共接口和禁止绕过的状态边界。
- 工具名称、参数 Schema、输出 Schema 和中文渲染。
- 成功、拒绝、未找到和内部异常。

### 11.2 契约测试

- 查询插件只依赖 `customerState` 的只读接口。
- 售后插件只通过 `customerApproval` 创建和消费确认。
- 提醒插件只通过 `customerEvents` 管理订阅和投递。
- 功能插件不直接导入其他功能插件源码。
- 生产 Bundle 不包含 `mock-operations`。

### 11.3 流程测试

必须覆盖：

1. 现有 `query_order` 和 `query_logistics` 零回归。
2. 已知 SKU、有货、缺货和未知 SKU。
3. 取消订单、退货、退款和改地址的成功与拒绝路径。
4. 确认过期、参数绑定、状态竞争和重复确认。
5. 三种异常物流及多异常稳定排序。
6. 补货、签收和退款状态变化提醒。
7. 同一事件只提醒一次。
8. 会话消失后的投递失败记录。
9. 单个功能插件禁用后其余插件仍可加载。
10. 生产和演示 Bundle 的依赖图与配置差异。

### 11.4 Web 验收

在真实 Harness Web 会话中验证：

- 三个查询工具。
- 一个售后资格拒绝流程。
- 一个完整的“预检 → 用户确认 → Harness 批准 → 执行”流程。
- 订阅商品补货后由模拟事件触发主动会话提醒。
- 订阅包裹送达后由模拟物流事件触发提醒。
- 订阅退款进度后由模拟状态变化触发提醒。
- 异常物流检查和订阅提醒。

## 12. 一键验证、打包与安装

仓库根目录增加无外部依赖的脚本入口，使以下命令从仓库根目录执行：

```bash
npx -y pnpm@11.7.0 run customer-service:verify
npx -y pnpm@11.7.0 run customer-service:package
npx -y pnpm@11.7.0 run customer-service:install:web
```

根目录新增私有 `package.json`，只声明这三个委托脚本，不接管新套件的依赖图；
真正的 workspace 和锁文件位于 `examples/dsh-customer-service-suite/`。这样不会把现有两个独立示例隐式改造成同一个 pnpm workspace。

`customer-service:verify`：

- 安装锁定依赖。
- 运行全部共享包、插件和 Bundle 测试。
- 运行 TypeScript 构建。
- 检查产物和 Bundle 配置。

`customer-service:package`：

- 清理本套件自己的暂存输出目录，不触碰其他仓库文件。
- 构建并打包每个独立模块。
- 生成包含模块名、版本、文件和校验信息的总清单。
- 输出到 `dist/customer-service-suite/`。

`customer-service:install:web`：

- 先调用完整验证和打包。
- 按总清单把共享服务、插件和聚合 Bundle 安装到 `web` Profile。
- 默认安装演示 Bundle，以便本地内存数据和提醒验收可用。
- 检查最终配置只加载一个客服聚合 Bundle 层，不重复注册工具。
- 重启服务仍由明确的运行命令完成，安装脚本不擅自结束其他进程。

单模块命令示例：

```bash
npx -y pnpm@11.7.0 \
  --dir examples/dsh-customer-service-suite \
  --filter dsh-plugin-customer-refund-order test
```

## 13. 迁移策略

1. 保留 `examples/dsh-plugin-order-query` 和其现有测试作为基线。
2. 在新套件中分别实现模块化 `query-order` 和 `query-logistics`。
3. 使用契约测试证明两个新工具与现有参数、结果和中文渲染一致。
4. 全套 Web 验收通过后，从 `web` Profile 移除旧 `dsh-plugin-order-query` 链接。
5. 安装新的演示 Bundle，确认工具名没有重复。
6. 旧目录继续保留但标记为 legacy baseline；后续修改只发生在模块化套件。

## 14. 完成定义

- 查询、售后和主动服务范围内的每个功能都有独立插件。
- 共享状态、事件、确认和审计均通过 Service 接口访问。
- 每个模块可以单独修改、测试、构建和停用。
- 生产 Bundle 不包含模拟运营工具，演示 Bundle 可以完整触发提醒。
- 售后写操作全部经过预检、一次性确认、重新校验、幂等执行和审计。
- 主动提醒准确绑定订阅会话，事件去重有效，失败投递不回滚业务状态。
- 固定业务规则、异常代码和错误边界均有自动化测试。
- 一键验证、打包和安装命令全部成功。
- 真实 Web UI 的查询、售后确认和四类主动服务验收通过。
- 最终功能合并到 `main`，Web Profile 指向模块化客服套件，Git 工作区保持清洁。
