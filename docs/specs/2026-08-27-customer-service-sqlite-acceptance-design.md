# 客服套件 SQLite 验收数据库设计

## 1. 目标

为 DeepSeek Harness 模块化客服套件增加一个仅用于本地功能验收的 SQLite 持久化层。数据库首次使用时自动创建，不要求用户预先安装 SQLite 或运行数据库服务器。现有 `query_order`、`query_logistics`、`query_inventory` 工具接口和中文输出保持不变。

数据库固定存放在项目根目录的 `data/customer-service.db`，不与 Harness Web Profile 放在一起，不提交到 Git，也不作为生产数据库使用。数据在 Harness 重启后保留；需要恢复固定验收数据时，由用户显式执行一键重置命令。

## 2. 范围

本阶段持久化以下五类业务数据：

- 订单；
- 物流；
- 库存；
- 退货申请；
- 退款。

提醒订阅、领域事件投递记录、审批记录仍保存在内存中。它们属于后续主动服务和售后工作流阶段，不进入本次 SQLite 验收数据库。

## 3. 模块架构

新增独立包 `@dsh-customer-service/storage-sqlite`，通过 Node.js 内置的 `node:sqlite` 访问数据库。当前运行环境为 Node.js `v22.22.0`，已经验证 `DatabaseSync` 可正常建表、插入和查询。Node 22 可能输出 SQLite 实验功能警告，该警告不影响本地验收；本项目不为消除警告而增加原生 npm 依赖。

模块调用关系如下：

```text
query_order / query_logistics / query_inventory
                       ↓
              customerState
         业务校验、版本、领域事件
                       ↓
          customerSqliteStorage
       建表、查询、事务、数据持久化
                       ↓
 data/customer-service.db
```

职责边界：

- 查询和写入工具继续只依赖公开的 `customerState` 服务；
- `customerState` 负责业务校验、对象版本、串行执行和领域事件；
- `customerSqliteStorage` 负责目录创建、迁移、SQL 查询、事务和记录序列化；
- 内存存储保留为隔离单元测试的默认测试实现；
- 生产和演示 Bundle 均先加载 SQLite 存储，再加载 `customerState`；
- Web 安装脚本把数据库绝对路径写入 Profile 的用户 Patch，避免启动目录改变数据库位置。

## 4. 数据库文件与 Git 规则

数据库文件：

```text
/Users/mac/Documents/ChatGPT/deepseek harness/data/customer-service.db
```

Git 忽略范围包括：

```text
data/customer-service.db
data/customer-service.db-wal
data/customer-service.db-shm
data/backups/*.db
```

`data/` 中只保留说明性文件；数据库、WAL、共享内存和重置备份均不进入版本控制。

## 5. 表结构

### 5.1 `orders`

- `order_id`：主键；
- `customer_id`；
- `status`；
- `address`；
- `estimated_delivery`；
- `items_json`：订单商品数组；
- `total_amount`；
- `created_at`；
- `delivered_at`：可空；
- `updated_at`；
- `version`。

### 5.2 `logistics`

- `order_id`：主键并关联订单；
- `status`；
- `current_status`；
- `events_json`：按顺序保存物流轨迹；
- `updated_at`；
- `version`。

### 5.3 `inventories`

- `sku`：主键；
- `product_name`；
- `stock`：必须大于或等于 0；
- `updated_at`；
- `version`。

### 5.4 `return_requests`

- `return_id`：主键；
- `order_id`：关联订单；
- `reason`；
- `status`；
- `created_at`；
- `version`。

### 5.5 `refunds`

- `refund_id`：主键；
- `order_id`：关联订单；
- `return_id`：可空，存在时关联退货申请；
- `amount`：必须大于或等于 0；
- `reason`；
- `status`；
- `updated_at`；
- `version`。

### 5.6 `customer_meta`

- `key`：主键；
- `value`。

该表至少保存种子数据版本。数据库结构版本使用 SQLite `PRAGMA user_version` 管理。

## 6. 初始化与迁移

打开数据库时设置：

```text
PRAGMA foreign_keys = ON
PRAGMA journal_mode = WAL
PRAGMA busy_timeout = 5000
```

首次初始化按以下顺序执行：

1. 创建 `data/` 目录；
2. 打开 `customer-service.db`；
3. 在事务中执行缺失的结构迁移；
4. 数据库尚未标记种子版本时，写入固定订单、物流和库存数据；
5. 将 `seed_version` 写为 `1`；
6. 提交事务。

数据库已经存在时只检查和执行必要迁移，不重复写入种子数据，不覆盖用户为验收做出的修改。结构迁移必须按版本顺序执行；任一迁移失败则回滚并保留升级前数据。

## 7. 读写与事务

读取方法保留当前同步接口，包括 `getOrder()`、`getLogistics()`、`getInventory()`、`getReturn()`、`getRefund()`、`findReturnByOrder()` 和 `findRefundByOrder()`。SQLite 行在返回前转换为现有领域对象，并进行结构化复制，调用方不能通过修改返回对象改变存储状态。

每次创建或更新使用单个事务：

1. 开始事务；
2. 读取当前记录及 `version`；
3. 执行业务 Patch 和现有校验；
4. 生成 `version + 1` 的下一状态；
5. 使用旧版本作为写入条件；
6. 提交事务；
7. 生成领域事件；
8. 由调用工具在提交后发布事件。

SQL、校验或版本冲突发生时回滚事务，不发布领域事件。现有同一业务对象串行执行队列继续保留；数据库版本条件用于阻止其他进程或连接的写入覆盖。

## 8. 错误处理

- 不存在的业务对象继续抛出 `EntityNotFoundError`；
- 重复创建继续抛出 `EntityAlreadyExistsError`；
- 库存和退款金额不得小于 0；
- 数据库忙时等待最多 5000 毫秒，超时后返回可识别的存储错误；
- JSON 字段解析失败时报告数据损坏，不自动重置或覆盖数据库；
- 数据库路径必须是安装脚本写入的明确绝对路径，或测试显式传入的临时路径；
- Harness 停止时关闭 SQLite 连接；
- 数据库初始化失败时不得注册一个不可用的 `customerState` 服务。

## 9. 一键命令

新增根目录命令：

```bash
npx -y pnpm@11.7.0 run customer-service:db:init
npx -y pnpm@11.7.0 run customer-service:db:reset
npx -y pnpm@11.7.0 run customer-service:db:inspect
```

- `customer-service:db:init`：创建目录和数据库、执行迁移；不覆盖已有数据；
- `customer-service:db:reset`：先生成数据库备份，再在事务中清空五类业务表并恢复固定验收数据；
- `customer-service:db:inspect`：输出数据库绝对路径、结构版本、种子版本及五类记录数量。

现有命令 `customer-service:install:web` 保持不变。它在打包和安装前执行非破坏性的数据库初始化，并把数据库绝对路径写入 `/Users/mac/.dsh/profiles/web/cordis.patch.yml` 中对应 SQLite 存储节点的配置。重复安装不得重置已有验收数据，也不得删除用户已有的其他 Profile Patch。

## 10. Bundle 与打包

生产 Bundle 增加 SQLite 存储节点，总节点数从 6 变为 7。演示 Bundle 同样增加该节点，总节点数从 7 变为 8。加载顺序必须满足：

```text
customer-sqlite-storage
  → customer-state
  → customer-events / customer-approval
  → query tools
  → mock operations（仅演示 Bundle）
```

打包清单新增 SQLite 存储包。该包不携带 Cordis 或 Harness 的重复运行时，也不新增需要本机编译的数据库依赖。

## 11. 自动测试

所有数据库测试使用独立临时目录和临时数据库，禁止修改项目正式验收文件。测试至少覆盖：

- 首次打开自动创建目录、数据库和完整表结构；
- 首次初始化写入固定种子数据；
- 重复打开不覆盖修改后的数据；
- 订单、物流、库存、退货、退款的读取和写入；
- 版本连续递增和旧版本写入冲突；
- 负库存、负退款金额和其他失败路径回滚；
- JSON 数据损坏返回明确错误；
- 重置前创建备份，重置后恢复固定数据；
- `db:inspect` 返回准确结构版本和记录数；
- Bundle 节点数、顺序和配置正确；
- 安装脚本保留已有 Profile Patch，并准确写入数据库绝对路径；
- 现有查询、事件、审批、演示写工具及兼容测试全部继续通过；
- TypeScript 构建与一键打包验证通过。

## 12. 运行验收

最终必须完成以下真实 Harness 验收：

1. 执行数据库重置；
2. 一键安装并启动 Web；
3. 调用 `query_inventory` 查询 `SKU-1002`，确认库存为 0；
4. 调用 `mock_set_inventory` 将 `SKU-1002` 库存改为 5；
5. 停止并重新启动 Harness；
6. 再次调用 `query_inventory`，确认库存仍为 5；
7. 执行一键重置；
8. 再次查询并确认库存恢复为 0。

## 13. 验收标准

只有同时满足以下条件才可宣布完成：

- 用户无需安装 SQLite 或运行数据库服务；
- 数据库自动创建在项目 `data/customer-service.db`；
- 五类业务数据均由 SQLite 持久化；
- 现有工具接口和中文结果保持兼容；
- 重启 Harness 后修改仍存在；
- 重置命令可恢复固定验收数据且留有备份；
- 一键安装不会覆盖已有验收数据；
- 全部自动测试、构建、Bundle 验证和真实 Web 验收通过；
- 不提交数据库、WAL、共享内存或备份文件；
- 不引入生产数据库承诺或额外数据库服务依赖。
