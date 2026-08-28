# 退款插件

提供 `request_refund` 和 `confirm_refund`。取消订单或存在 `approved`/`received` 退货的订单可整单退款，金额始终取订单总额；已有非失败退款会阻止重复申请，失败后可重试。

```bash
pnpm --filter dsh-plugin-customer-refund-order test
```
