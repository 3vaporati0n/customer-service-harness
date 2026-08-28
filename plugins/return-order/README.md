# 退货插件

提供 `request_return_order` 和 `confirm_return_order`。仅签收不超过 7 天且没有活动退货的订单可申请；确认后创建状态为 `approved` 的整单退货。已拒绝的退货不阻止重新申请。

```bash
pnpm --filter dsh-plugin-customer-return-order test
```
