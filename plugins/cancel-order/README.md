# 取消订单插件

提供 `request_cancel_order` 和 `confirm_cancel_order`。仅 `processing` 订单可取消；申请工具生成 10 分钟有效的确认编号，确认工具重新校验状态、执行取消、记录审计并发布订单事件。

```bash
pnpm --filter dsh-plugin-customer-cancel-order test
```
