# dsh-plugin-order-query

> **Legacy baseline：** 这个目录保留用于兼容测试和学习，不再是 `web` Profile 的主实现。新的模块化版本位于 [`../dsh-customer-service-suite`](../dsh-customer-service-suite/README.md)，后续客服功能只在新套件中扩展。

这是一个用于学习 DeepSeek Harness 的客服订单插件。它注册两个只读工具：`query_order` 查询订单状态，`query_logistics` 查询物流轨迹；两个工具都返回结构化结果，再由 Harness 渲染为中文客服文本。

测试和构建不需要 DeepSeek API Key；只有 Web UI 的模型调用需要已经配置好的 Provider。

## 先看懂数据流

```text
用户问题
  -> 模型选择 query_order
  -> Harness 校验 orderId
  -> orders.ts 标准化并查询订单
  -> Harness 校验 oneOf 输出
  -> render() 生成中文文本
```

- `src/orders.ts`：纯业务模块，不依赖 Harness。
- `src/logistics.ts`：纯物流业务模块，复用订单号规则但不依赖 Harness。
- `src/index.ts`：Harness 适配层，负责注册两个工具、Schema 和渲染。
- `tests/orders.test.mjs`：验证标准化、查询和输入错误。
- `tests/logistics.test.mjs`：验证两条模拟轨迹、标准化、未找到和空输入。
- `tests/plugin.test.mjs`：验证工具接口、输出分支和中文文本。
- `cordis.patch.yml`：把插件插入 Harness Bundle。

## 模拟订单

| 订单号 | 业务状态 | 物流状态 | 预计送达 |
|---|---|---|---|
| `ORDER-1001` | `shipped` | 运输中 | `2026-08-28` |
| `ORDER-1002` | `processing` | 待发货 | `2026-08-30` |

订单号会先执行 `trim()` 和 `toUpperCase()`，所以 ` order-1001 ` 也能匹配 `ORDER-1001`。未知非空订单返回 `found: false`；空订单号抛出输入错误。

## 物流轨迹工具

`query_logistics` 与 `query_order` 使用相同的 `orderId`，但返回 `currentStatus` 和 `events` 数组。`ORDER-1001` 有上海、苏州两个轨迹节点；`ORDER-1002` 有一条商家仓库待发货节点。

```text
订单 ORDER-1001 当前物流状态：运输中。
2026-08-26 09:20｜上海分拨中心｜包裹已发出
2026-08-26 18:40｜苏州转运中心｜包裹运输中
```

## 测试和构建

需要 Node.js `22.19.0` 或更新的兼容版本：

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 install
npx -y pnpm@11.7.0 test
npx -y pnpm@11.7.0 build
```

成功时应看到 `22 passed`，并在被 Git 忽略的 `lib/` 中生成 JavaScript 和声明文件。

## 安装并检查 Bundle

先安装到隔离的学习 Profile：

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile order-query-guide add .
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile order-query-guide --dump-config
```

最终配置中应出现：

```yaml
# == dsh-plugin-order-query
- id: order-query-tool
  name: dsh-plugin-order-query
```

这一步只验证安装和配置组合，不调用模型。

## 在 Web UI 中验证

将插件安装到 `web` Profile 后重启服务：

```bash
cd "/Users/mac/Documents/ChatGPT/deepseek harness/examples/dsh-plugin-order-query"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh plugin --profile web add .
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh --profile web --dump-config
cd "/Users/mac/Documents/ChatGPT/deepseek harness"
npx -y pnpm@11.7.0 --package=@deepseek-ai/dsh dlx dsh web --no-open
```

在新会话输入：

```text
必须调用 query_order 工具查询订单 order-1001，只返回工具结果。
```

预期：

```text
订单 ORDER-1001 当前状态：已发货；物流状态：运输中；预计送达时间：2026-08-28。
```

再输入：

```text
必须调用 query_logistics 工具查询订单 order-1001 的物流轨迹，只返回工具结果。
```

预期：

```text
订单 ORDER-1001 当前物流状态：运输中。
2026-08-26 09:20｜上海分拨中心｜包裹已发出
2026-08-26 18:40｜苏州转运中心｜包裹运输中
```

最后输入：

```text
必须调用 query_logistics 工具查询订单 unknown-001 的物流轨迹，只返回工具结果。
```

预期：

```text
未找到订单 UNKNOWN-001，请检查订单号。
```
