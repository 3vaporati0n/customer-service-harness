# 客服套件模块地图

## 共享平台

| 包名 | 目录 | 修改入口 | 公开能力 |
|---|---|---|---|
| `@dsh-customer-service/domain` | `packages/customer-domain` | `src/index.ts`、`src/seeds.ts`、`src/tool-definition.ts` | 类型、错误、时钟、固定种子、运行时中立的工具定义器 |
| `@dsh-customer-service/storage-sqlite` | `packages/customer-storage-sqlite` | `src/storage.ts`、`src/lifecycle.ts` | `ctx.customerStorage`、SQLite 建表、迁移、事务、备份和重置 |
| `@dsh-customer-service/state` | `packages/customer-state` | `src/index.ts`、`src/memory-storage.ts` | `ctx.customerState`、业务校验、串行事务、领域事件、测试内存存储 |
| `@dsh-customer-service/events` | `packages/customer-events` | `src/index.ts` | `ctx.customerEvents`、订阅、匹配器、去重、会话投递 |
| `@dsh-customer-service/approval` | `packages/customer-approval` | `src/index.ts` | `ctx.customerApproval`、10 分钟确认、幂等审计、批准守卫 |

功能插件不得直接导入其他功能插件源码，也不得直接访问 SQLite。所有业务读写均通过 `customerState` 完成。

## 查询插件

| 包名 | 工具 | 目录 |
|---|---|---|
| `dsh-plugin-customer-query-order` | `query_order` | `plugins/query-order` |
| `dsh-plugin-customer-query-logistics` | `query_logistics` | `plugins/query-logistics` |
| `dsh-plugin-customer-query-inventory` | `query_inventory` | `plugins/query-inventory` |

订单和物流插件通过根级兼容测试与旧 `dsh-plugin-order-query` 对比 canonical value 和中文 render。

## 售后插件

| 包名 | 预检工具 | 确认工具 | 目录 |
|---|---|---|---|
| `dsh-plugin-customer-cancel-order` | `request_cancel_order` | `confirm_cancel_order` | `plugins/cancel-order` |
| `dsh-plugin-customer-return-order` | `request_return_order` | `confirm_return_order` | `plugins/return-order` |
| `dsh-plugin-customer-refund-order` | `request_refund` | `confirm_refund` | `plugins/refund-order` |
| `dsh-plugin-customer-change-address` | `request_address_change` | `confirm_address_change` | `plugins/change-address` |

## 主动提醒插件

| 包名 | 工具 | 触发事件 | 目录 |
|---|---|---|---|
| `dsh-plugin-customer-refund-progress-alert` | `subscribe_refund_progress_alert` | `refund.updated` 状态变化 | `plugins/refund-progress-alert` |

预检工具只读取最新状态并创建十分钟确认；确认工具重新校验资格，再经 Harness 单次批准执行、写审计并发布领域事件。四个插件彼此不导入，可单独修改和停用。

## 演示操作

`dsh-plugin-customer-mock-operations` 只属于演示 Bundle：

| 工具 | 修改内容 |
|---|---|
| `mock_set_inventory` | 设置某个 SKU 的验收库存 |
| `mock_append_logistics_event` | 追加物流节点并更新内部状态 |
| `mock_set_refund_status` | 修改退款状态并发布退款更新事件 |
| `mock_advance_clock` | 前进确定性测试时钟 |

每次成功修改都先由 `customerState` 提交并生成事件，然后交给 `customerEvents.publish()`；失败修改不发布事件。

## 测试数据录入

`dsh-plugin-customer-test-data-entry` 只属于演示 Bundle，并依赖 `tools + customerState + customerEvents`：

| 工具 | 新增记录 |
|---|---|
| `test_create_inventory` | 商品库存 |
| `test_create_order` | 引用已有 SKU 的订单 |
| `test_create_logistics` | 已有订单的物流主记录和首条轨迹 |
| `test_create_return` | 已有订单的退货记录 |
| `test_create_refund` | 已有订单的退款记录，可关联同订单退货 |

插件注册、批准策略在 `plugins/test-data-entry/src/index.ts`；工具 Schema、调用和中文渲染在 `plugins/test-data-entry/src/tools.ts`。插件不导入 SQLite，所有严格校验和事务写入都经由 `customerState`，提交成功后再调用 `customerEvents.publish()`。

## Bundle

```text
customer-service-suite
  ├─ customer-sqlite-storage
  ├─ customer-state
  ├─ customer-events
  ├─ customer-approval
  ├─ query-order
  ├─ query-logistics
  ├─ query-inventory
  ├─ cancel-order
  ├─ return-order
  ├─ refund-order
  ├─ change-address
  └─ refund-progress-alert

customer-service-demo
  └─ 上述全部模块 + mock-operations + test-data-entry
```

加载顺序由各 Bundle 的 `cordis.patch.yml` 明确声明。`scripts/verify-bundles.mjs` 会检查顺序、重复 ID、重复包名和 `workspace:^` 依赖。

打包产物使用内容寻址文件名；安装器先同步 Profile 中已有依赖的 tarball 地址，再由演示 Bundle 统一加载插件。发布包不携带 Harness 核心运行时副本，防止 Cordis 与工具调度 Symbol 被重复实例化。

## 测试命令

```bash
# 全套
npx -y pnpm@11.7.0 run verify

# 单个共享 Service
npx -y pnpm@11.7.0 --filter @dsh-customer-service/state test

# 单个功能插件
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-order test
```

模块构建命令把最后的 `test` 换成 `build`。产物写入各模块被 Git 忽略的 `lib/`。

## 后续扩展位置

生产 Bundle 不包含 `mock-operations` 和 `test-data-entry` 两个验收插件。退款进度提醒已经实现；后续可在 `plugins/` 中继续增加异常物流、补货、签收和订阅管理插件。共享 Service 的公开接口已经覆盖退货/退款状态、领域事件、会话订阅和一次性确认。
