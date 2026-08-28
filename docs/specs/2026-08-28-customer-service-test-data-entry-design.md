# 客服测试数据录入模块设计

日期：2026-08-28
状态：设计已通过，等待书面规格复核

## 1. 目标

为 DeepSeek Harness 模块化客服套件增加一个只用于本地验收的 Web 测试数据录入插件。用户通过自然语言触发五个结构化工具，在 Harness 单次审批后新增库存、订单、物流、退货和退款记录。所有业务数据通过 `customerState` 写入现有 SQLite 验收数据库，不允许插件直接访问数据库或执行任意 SQL。

完成后应能在 Web 中按顺序创建一组有关联的测试数据，重启 Harness 后仍可查询，并能通过现有 `customer-service:db:reset` 命令备份后恢复固定种子。

## 2. 范围

### 2.1 本阶段包含

- 新建独立插件包 `dsh-plugin-customer-test-data-entry`。
- 提供五个严格分离的创建工具：
  - `test_create_inventory`
  - `test_create_order`
  - `test_create_logistics`
  - `test_create_return`
  - `test_create_refund`
- 为 `CustomerStorage` 增加订单、库存和物流的新增接口。
- 为内存存储与 SQLite 存储实现五类实体的严格新增语义。
- 为 `CustomerStateService` 增加订单、库存和物流创建方法，并强化五类创建操作的业务校验。
- 成功提交后发布现有领域事件。
- 插件只加入 `customer-service-demo` Bundle。
- 更新打包、安装、模块地图和使用说明。

### 2.2 本阶段不包含

- 不向生产 Bundle 加入测试数据工具。
- 不提供任意 SQL、数据库控制台或任意 JSON 直写。
- 不允许创建工具覆盖、更新或删除已有实体。
- 不新增批量导入命令。
- 不新增真实生产数据库或外部订单、仓储、物流、支付系统连接。
- 不在本阶段增加退货或退款查询工具；它们通过工具返回值、数据库检查和持久化测试验收。

## 3. 架构

```text
Web 对话
  → test_create_* 工具
  → Harness tools/pre-execute 单次审批
  → customerState 规范化与业务校验
  → customerStorage 事务写入
  → SQLite 验收数据库
  → customerEvents 发布领域事件
```

职责边界：

- `customer-domain` 定义实体、错误与存储合同。
- `customer-state` 负责业务编号、关联、数值、时间、版本、事务和事件。
- `customer-storage-sqlite` 负责持久化、唯一约束与数据库错误转换。
- `customer-test-data-entry` 只负责工具 Schema、调用 State、发布事件和中文渲染。
- `customer-events` 继续负责提交后的事件投递和去重。
- Bundle 决定测试工具是否进入运行环境。

插件不得直接导入 SQLite 实现，也不得直接写数据库表。

## 4. 存储与 State 合同

### 4.1 CustomerStorage

在现有合同中增加：

```ts
insertOrder(record: Order): void
insertInventory(record: Inventory): void
insertLogistics(record: Logistics): void
```

既有 `insertReturn()` 和 `insertRefund()` 保持不变。五个 `insert` 方法均采用严格新增语义：主键或业务唯一键已存在时抛出 `EntityAlreadyExistsError`，不得转为更新。

内存存储和 SQLite 存储必须具有相同的可观察行为。SQLite 唯一约束错误必须转换为领域错误，不向工具层泄露 SQL 或表结构细节。

### 4.2 CustomerStateService

新增：

```ts
createInventory(input): Promise<StateChange<Inventory>>
createOrder(input): Promise<StateChange<Order>>
createLogistics(input): Promise<StateChange<Logistics>>
```

继续使用并强化：

```ts
createReturn(input): Promise<StateChange<ReturnRequest>>
createRefund(input): Promise<StateChange<Refund>>
```

所有创建方法必须：

1. 规范化业务编号；
2. 在写入前校验字段和关联；
3. 在存储事务中完成最终关联检查与新增；
4. 写入 `version = 1`；
5. 使用当前验收时钟生成时间字段；
6. 返回 `before: null`、完整 `after` 和对应领域事件。

## 5. 工具合同

### 5.1 test_create_inventory

必填参数：

- `sku: string`
- `productName: string`
- `stock: integer`，必须大于等于 0

系统生成：

- `updatedAt = clock.now().toISOString()`
- `version = 1`

成功渲染：

```text
测试商品 SKU-TEST-001（测试鼠标）已创建，库存 20 件。
```

### 5.2 test_create_order

必填参数：

- `orderId: string`
- `customerId: string`
- `address: string`
- `estimatedDelivery: string`
- `items: Array<{ sku: string; quantity: integer; unitPrice: number }>`

可选参数：

- `status: processing | shipped | delivered | cancelled`，默认 `processing`

规则：

- `items` 至少一项；
- `estimatedDelivery` 必须是有效的 `YYYY-MM-DD` 日期；
- 每个 SKU 必须已有库存记录；
- `quantity` 必须是正整数；
- `unitPrice` 必须大于等于 0；
- `totalAmount` 由 `sum(quantity × unitPrice)` 计算，工具不接受外部传入；
- 系统生成 `createdAt`、`updatedAt` 和 `version = 1`；
- 状态为 `delivered` 时，系统把 `deliveredAt` 设置为当前验收时间；其他状态不设置该字段。

成功渲染：

```text
测试订单 ORDER-TEST-001 已创建，共 2 件商品，金额 198 元。
```

### 5.3 test_create_logistics

必填参数：

- `orderId: string`
- `location: string`
- `description: string`

可选参数：

- `status: pending_shipment | in_transit | delivered | delivery_failed`，默认 `pending_shipment`

规则：

- 订单必须存在；
- 同一订单不得已有物流主记录；
- `currentStatus` 由状态映射为中文；
- 第一条物流事件使用当前验收时间；
- 系统生成 `updatedAt` 和 `version = 1`；
- 后续轨迹继续使用 `mock_append_logistics_event`。

成功渲染：

```text
订单 ORDER-TEST-001 的测试物流已创建，当前状态：待发货。
```

### 5.4 test_create_return

必填参数：

- `returnId: string`
- `orderId: string`
- `reason: string`
- `status: approved | received | rejected`

规则：

- 订单必须存在；
- 同一订单只能有一条退货记录；
- 系统生成 `createdAt` 和 `version = 1`。

成功渲染：

```text
订单 ORDER-TEST-001 的退货记录 RETURN-TEST-001 已创建，状态：已批准。
```

### 5.5 test_create_refund

必填参数：

- `refundId: string`
- `orderId: string`
- `amount: number`，必须大于等于 0
- `reason: string`

可选参数：

- `returnId: string`
- `status: pending | processing | succeeded | failed`，默认 `pending`

规则：

- 订单必须存在；
- 同一订单只能有一条退款记录；
- 如果填写 `returnId`，退货记录必须存在且属于同一订单；
- 系统生成 `updatedAt` 和 `version = 1`。

成功渲染：

```text
订单 ORDER-TEST-001 的退款记录 REFUND-TEST-001 已创建，金额 198 元，状态：待处理。
```

## 6. 共同校验规则

- 所有业务编号去除首尾空格并转换为大写。
- 业务编号、客户编号、名称、地址、原因、位置和描述不得为空白。
- 时间统一保存为 ISO 8601 字符串。
- 重复编号一律拒绝，不提供覆盖确认分支。
- 订单 SKU、物流订单、退货订单和退款订单必须存在。
- 退款引用的退货记录必须属于同一订单。
- 数量必须是正整数；库存、单价、金额不得为负数或非有限数。
- 失败不得写入部分记录，也不得发布领域事件。

## 7. 审批与安全

五个工具都通过 `tools/pre-execute` 返回 `kind: 'ask'`。审批理由固定说明该操作将新增本地 SQLite 验收数据。审批界面依靠工具调用详情展示完整参数，用户选择“允许一次”后才执行。

生产 Bundle 保持不变。测试插件只加入演示 Bundle，并且不导出数据库连接、不接受 SQL、不接受未知字段。

## 8. 事务、并发与事件

- 单次调用只创建一个实体。
- 业务校验和新增由 `CustomerStateService` 组织，并在单个存储事务中完成。
- 同一实体编号使用现有排他队列串行化。
- 并发创建相同编号时只能有一个成功。
- 数据库提交成功后，插件调用 `customerEvents.publish(change.event)`。
- 创建失败时不调用事件发布。
- 事件发布发生在数据库提交之后；投递异常不得回滚已经提交的业务数据，但错误必须向调用方暴露，便于识别“数据已写入、通知失败”的状态。

## 9. 错误合同

错误信息使用中文业务语义，不暴露 SQL：

- `业务实体 ORDER-TEST-001 已存在。`
- `订单 ORDER-TEST-001 不存在，无法创建物流记录。`
- `商品 SKU-TEST-001 不存在，无法加入订单。`
- `退货记录 RETURN-TEST-001 不属于订单 ORDER-TEST-001。`
- `订单商品数量必须为正整数。`
- `订单商品单价不能小于 0。`
- `退款金额不能小于 0。`

Schema 层拒绝未知字段、错误枚举和明显类型错误；State 层负责跨字段、跨实体与数值语义校验；Storage 层负责唯一约束、版本与数据库内容完整性。

## 10. Bundle、打包与安装

- `customer-service-suite` 生产 Bundle 仍为 7 个节点。
- `customer-service-demo` 在现有 8 个节点后追加测试数据录入插件，变为 9 个节点。
- 打包清单从 11 个模块增加为 12 个模块。
- 安装器继续安装演示 Bundle，因此重新运行 `customer-service:install:web` 后五个工具可用。
- Profile 的 SQLite `databasePath` 配置保持不变。

## 11. 测试与验收

### 11.1 自动化测试

- Domain/Memory Storage：五类新增、重复拒绝和拷贝隔离。
- SQLite Storage：五类新增跨重启持久化、唯一冲突转换和事务回滚。
- State：编号规范化、自动时间、版本、金额计算、空值与数值校验、严格关联、事件内容。
- Plugin：五个工具名、依赖、Schema、默认值、中文渲染、审批策略、成功发布事件、失败不发布事件。
- Bundle：生产 7、演示 9、无重复节点、插件只存在于演示 Bundle。
- Packaging/Install：清单 12 个模块，Profile 安装后插件和 SQLite 配置各出现一次。

### 11.2 真实 Web 验收

按顺序在新会话中：

1. 用 `test_create_inventory` 创建 `SKU-TEST-001`；
2. 用 `test_create_order` 创建引用该 SKU 的 `ORDER-TEST-001`；
3. 用 `test_create_logistics` 创建订单物流；
4. 用 `test_create_return` 创建 `RETURN-TEST-001`；
5. 用 `test_create_refund` 创建 `REFUND-TEST-001`；
6. 重启 Harness；
7. 用现有查询工具验证订单、物流和库存；
8. 通过 SQLite 存储检查退货和退款记录；
9. 重复创建一个已存在编号并确认被拒绝；
10. 执行 `customer-service:db:reset`，确认产生备份并恢复固定种子。

## 12. 完成标准

- 五个工具可在 Web 演示 Profile 中发现和调用。
- 每次写入前出现单次审批。
- 五类记录都能严格新增并跨 Harness 重启保留。
- 重复、孤立关联和非法数值被拒绝且不产生部分数据或事件。
- 生产 Bundle 不含测试录入工具。
- 全量测试、Bundle 验证、打包、安装和真实 Web 验收全部通过。
- 使用文档包含五类工具示例、重启说明和 `db:reset` 恢复命令。
