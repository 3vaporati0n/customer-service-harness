# DeepSeek Harness 模块化客服套件

这是客服系统的“平台、查询与售后”阶段实现。它把共享状态、事件、审批、查询和四类售后流程拆成独立 npm 包，再通过 Bundle 选择生产或演示组合。每个模块都可以单独修改、测试、构建和替换。

当前已经提供：

- `query_order`：查询订单状态、物流状态和预计送达时间。
- `query_logistics`：查询物流状态和完整轨迹。
- `query_inventory`：查询商品名、库存数量和是否有货。
- `customerStorage`：把订单、物流、库存、退货和退款保存到本地 SQLite 验收数据库。
- `customerState`：在存储层之上执行业务校验、版本控制、串行事务和领域事件。
- `customerEvents`：保存提醒订阅、去重领域事件并向原 Agent 会话投递消息。
- `customerApproval`：保存一次性确认、审计和售后确认工具批准策略。
- 四个演示写工具：修改库存、追加物流事件、修改退款状态、前进假时钟。
- 五个测试数据录入工具：严格新增库存、订单、物流、退货和退款记录。
- `request_cancel_order` / `confirm_cancel_order`：预检并确认取消处理中订单。
- `request_return_order` / `confirm_return_order`：预检七天退货资格并创建已批准退货。
- `request_refund` / `confirm_refund`：按订单总额预检并创建待处理退款。
- `request_address_change` / `confirm_address_change`：预检并确认修改处理中订单的完整地址。
- `subscribe_refund_progress_alert`：订阅退款状态变化并向当前 Harness 会话主动发送提醒。

退款进度主动提醒已经注册业务工具；异常物流、补货和签收提醒可继续复用现有事件与会话订阅接口开发。

## 一键命令

在仓库根目录运行：

```bash
npx -y pnpm@11.7.0 run verify
npx -y pnpm@11.7.0 run package:suite
npx -y pnpm@11.7.0 run install:web
npx -y pnpm@11.7.0 run db:inspect
```

- `verify`：安装旧版兼容基线的锁定依赖，构建全部模块，运行子包与兼容测试，检查两个 Bundle。
- `package:suite`：先完整验证，再生成 17 个带内容哈希的 tarball 和 `manifest.json`，避免同版本本地包被 pnpm 旧缓存覆盖。
- `install:web`：重新打包，把演示 Bundle 安装到 `web` Profile，更新本地依赖地址，并移除旧订单查询 Bundle。
- `db:inspect`：显示数据库路径、结构版本、种子版本以及五类业务记录数量。

客服包只在开发期依赖 Cordis、`dsh-tools`、`dsh-agent` 和 `dsh-llm` 的类型；安装产物不会复制 Harness 核心运行时，所有 Service 都通过当前进程传入的 `ctx` 注册，避免跨包 Symbol 不一致。

安装脚本不会停止或启动 Web 服务。安装完成后需要显式重启：

```bash
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
```

## 单模块修改

例如只修改库存查询：

```bash
cd "/Users/mac/Documents/ChatGPT/customer-service-harness"
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-inventory test
npx -y pnpm@11.7.0 --filter dsh-plugin-customer-query-inventory build
```

其他包把 `--filter` 后的名称替换为 [模块地图](docs/module-map.md) 中的包名即可。

## 生产与演示 Bundle

- `dsh-bundle-customer-service-suite`：生产组合，加载共享 Service、三个只读查询插件和四个售后插件。
- `dsh-bundle-customer-service-demo`：在生产组合上增加 `mock-operations` 和 `test-data-entry`，用于本地验收和后续主动提醒测试。

演示写工具会触发 Harness 的 `ask` 批准；生产 Bundle 完全不加载它们。每次批准只授权当前一次调用，测试数据录入工具不覆盖已有记录，重复编号会直接报错。

## 售后工具使用方式

售后操作固定分两步：先调用 `request_*` 获取十分钟有效的 `confirmationId`，再把该编号传给对应的 `confirm_*`。确认工具还会触发 Harness 的“允许一次”，因此模型不能只凭一条自然语言直接修改业务状态。

例如修改地址：

```text
必须调用 request_address_change，为订单 ORDER-1002 申请把地址修改为江苏省苏州市工业园区测试路 8 号，只返回工具结果。
```

拿到确认编号后发送：

```text
必须调用 confirm_address_change，确认编号为 CONFIRM-XXX，只返回工具结果。
```

取消和改地址只允许 `processing` 订单；退货只允许签收后七天内的订单；退款只允许已取消订单或已有 `approved`/`received` 退货的订单。退款金额始终取订单总额。重复调用已成功的确认编号只返回原结果，不会再次写入。

## SQLite 验收数据库

五类客服业务数据保存在主项目目录：

```text
data/customer-service.db
```

数据库只用于功能验收，不是生产数据库。首次安装或启动时会自动建表并写入固定种子；重复安装和 Harness 重启不会覆盖已有修改。提醒订阅、事件投递、审批和审计仍保存在内存中。

无需安装 SQLite 软件。当前 Node 22 使用内置 `node:sqlite` 时会打印实验功能警告，不影响验收。

数据库命令：

```bash
# 非破坏性初始化或迁移
npx -y pnpm@11.7.0 run db:init

# 检查结构和记录数
npx -y pnpm@11.7.0 run db:inspect

# 先备份，再恢复固定验收数据
npx -y pnpm@11.7.0 run db:reset
```

从功能 worktree 执行命令时，数据库仍写入主项目的 `data/`。数据库、WAL、共享内存和 `data/backups/` 下的备份均被 Git 忽略。

未来接入真实订单、仓储和支付系统时，应保留公开 Service 契约并替换 SQLite 存储适配器。

## Web 验收指令

安装并重启后，在三个新会话分别发送：

```text
必须调用 query_order 工具查询订单 order-1001，只返回工具结果。
```

```text
必须调用 query_logistics 工具查询订单 order-1001 的物流轨迹，只返回工具结果。
```

```text
必须调用 query_inventory 工具查询商品 sku-1002，只返回工具结果。
```

预期分别看到订单已发货、上海到苏州的两条物流轨迹，以及机械键盘库存 0 件并显示缺货。

### 新增一组完整测试数据

测试数据录入插件只存在于演示 Bundle。请按依赖顺序发送下面五条指令，并在确认工具名和业务编号正确后选择“允许一次”：

```text
必须调用 test_create_inventory 工具，创建商品 SKU-TEST-001，名称为测试鼠标，库存 20，只返回工具结果。
```

```text
必须调用 test_create_order 工具，创建订单 ORDER-TEST-001，客户 CUSTOMER-TEST-001，地址为苏州市工业园区，预计送达时间为 2026-09-01，包含 2 件 SKU-TEST-001，单价 99 元，只返回工具结果。
```

```text
必须调用 test_create_logistics 工具，为订单 ORDER-TEST-001 创建物流，位置为苏州仓库，描述为测试物流已创建，状态为 pending_shipment，只返回工具结果。
```

```text
必须调用 test_create_return 工具，为订单 ORDER-TEST-001 创建退货 RETURN-TEST-001，原因为不合适，状态为 approved，只返回工具结果。
```

```text
必须调用 test_create_refund 工具，为订单 ORDER-TEST-001 创建退款 REFUND-TEST-001，关联退货 RETURN-TEST-001，金额 198 元，原因为退货退款，状态为 pending，只返回工具结果。
```

订单引用的 SKU 必须先存在，物流、退货和退款引用的订单必须先存在，退款填写退货编号时必须属于同一订单。同一订单只能有一条物流主记录；最多存在一条活动退货记录和一条非失败退款记录，退货被拒或退款失败后可以重新申请。

这些记录保存在主项目的 SQLite 验收数据库中，重启 Harness 后仍然存在。需要重新开始验收时运行：

```bash
npx -y pnpm@11.7.0 run db:reset
```

该命令会先把当前数据库备份到 `data/backups/`，再恢复固定种子数据。
