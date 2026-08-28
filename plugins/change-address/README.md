# 修改地址插件

提供 `request_address_change` 和 `confirm_address_change`。仅 `processing` 订单可修改完整收货地址；确认编号绑定规范化地址，确认工具重新校验并只更新订单地址。

```bash
pnpm --filter dsh-plugin-customer-change-address test
```
