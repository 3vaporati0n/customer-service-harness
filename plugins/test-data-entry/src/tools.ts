import type { Context } from '@deepseek-ai/cordis'
import {
  defineCustomerTool,
  EntityAlreadyExistsError,
  type RefundStatus,
  type ReturnStatus,
} from '@dsh-customer-service/domain'

const RETURN_LABELS: Record<ReturnStatus, string> = {
  approved: '已批准',
  received: '已收到退货',
  rejected: '已拒绝',
}

const REFUND_LABELS: Record<RefundStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  succeeded: '已退款',
  failed: '失败',
}

export function createTestDataTools(ctx: Context) {
  return [
    defineCustomerTool({
      name: 'test_create_inventory',
      description: '向本地验收数据库严格新增一条测试商品库存记录。',
      strictParameters: true,
      parameters: {
        sku: { type: 'string', required: true },
        productName: { type: 'string', required: true },
        stock: { type: 'integer', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sku: { type: 'string', required: true },
            productName: { type: 'string', required: true },
            stock: { type: 'integer', required: true },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `测试商品 ${value.sku}（${value.productName}）已创建，库存 ${value.stock} 件。`,
        }],
      },
      async execute(args) {
        const change = await ctx.customerState.createInventory(args)
        await ctx.customerEvents.publish(change.event)
        return {
          sku: change.after.sku,
          productName: change.after.productName,
          stock: change.after.stock,
          version: change.after.version,
        }
      },
    }),
    defineCustomerTool({
      name: 'test_create_order',
      description: '向本地验收数据库严格新增一条测试订单，商品 SKU 必须已存在。',
      strictParameters: true,
      parameters: {
        orderId: { type: 'string', required: true },
        customerId: { type: 'string', required: true },
        status: {
          type: 'string',
          enum: ['processing', 'shipped', 'delivered', 'cancelled'],
        },
        address: { type: 'string', required: true },
        estimatedDelivery: { type: 'string', required: true },
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sku: { type: 'string', required: true },
              quantity: { type: 'integer', required: true },
              unitPrice: { type: 'number', required: true },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            orderId: { type: 'string', required: true },
            status: {
              type: 'string',
              enum: ['processing', 'shipped', 'delivered', 'cancelled'],
              required: true,
            },
            itemCount: { type: 'integer', required: true },
            totalAmount: { type: 'number', required: true },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `测试订单 ${value.orderId} 已创建，共 ${value.itemCount} 件商品，金额 ${value.totalAmount} 元。`,
        }],
      },
      async execute(args) {
        const change = await ctx.customerState.createOrder({
          ...args,
          status: args.status ?? 'processing',
        })
        await ctx.customerEvents.publish(change.event)
        return {
          orderId: change.after.orderId,
          status: change.after.status,
          itemCount: change.after.items.reduce((sum, item) => sum + item.quantity, 0),
          totalAmount: change.after.totalAmount,
          version: change.after.version,
        }
      },
    }),
    defineCustomerTool({
      name: 'test_create_logistics',
      description: '为已有测试订单严格新增物流主记录和第一条轨迹。',
      strictParameters: true,
      parameters: {
        orderId: { type: 'string', required: true },
        status: {
          type: 'string',
          enum: ['pending_shipment', 'in_transit', 'delivered', 'delivery_failed'],
        },
        location: { type: 'string', required: true },
        description: { type: 'string', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            orderId: { type: 'string', required: true },
            status: {
              type: 'string',
              enum: ['pending_shipment', 'in_transit', 'delivered', 'delivery_failed'],
              required: true,
            },
            currentStatus: { type: 'string', required: true },
            eventCount: { type: 'integer', required: true },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `订单 ${value.orderId} 的测试物流已创建，当前状态：${value.currentStatus}。`,
        }],
      },
      async execute(args) {
        const change = await ctx.customerState.createLogistics({
          ...args,
          status: args.status ?? 'pending_shipment',
        })
        await ctx.customerEvents.publish(change.event)
        return {
          orderId: change.after.orderId,
          status: change.after.status,
          currentStatus: change.after.currentStatus,
          eventCount: change.after.events.length,
          version: change.after.version,
        }
      },
    }),
    defineCustomerTool({
      name: 'test_create_return',
      description: '为已有测试订单严格新增一条退货记录。',
      strictParameters: true,
      parameters: {
        returnId: { type: 'string', required: true },
        orderId: { type: 'string', required: true },
        reason: { type: 'string', required: true },
        status: {
          type: 'string',
          enum: ['approved', 'received', 'rejected'],
          required: true,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            returnId: { type: 'string', required: true },
            orderId: { type: 'string', required: true },
            status: {
              type: 'string',
              enum: ['approved', 'received', 'rejected'],
              required: true,
            },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `订单 ${value.orderId} 的退货记录 ${value.returnId} 已创建，状态：${RETURN_LABELS[value.status]}。`,
        }],
      },
      async execute(args) {
        const existing = ctx.customerState.findReturnByOrder(args.orderId)
        if (existing) throw new EntityAlreadyExistsError(existing.returnId)
        const change = await ctx.customerState.createReturn(args)
        await ctx.customerEvents.publish(change.event)
        return {
          returnId: change.after.returnId,
          orderId: change.after.orderId,
          status: change.after.status,
          version: change.after.version,
        }
      },
    }),
    defineCustomerTool({
      name: 'test_create_refund',
      description: '为已有测试订单严格新增一条退款记录，可关联同订单退货记录。',
      strictParameters: true,
      parameters: {
        refundId: { type: 'string', required: true },
        orderId: { type: 'string', required: true },
        returnId: { type: 'string' },
        amount: { type: 'number', required: true },
        reason: { type: 'string', required: true },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'succeeded', 'failed'],
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            refundId: { type: 'string', required: true },
            orderId: { type: 'string', required: true },
            amount: { type: 'number', required: true },
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'succeeded', 'failed'],
              required: true,
            },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `订单 ${value.orderId} 的退款记录 ${value.refundId} 已创建，金额 ${value.amount} 元，状态：${REFUND_LABELS[value.status]}。`,
        }],
      },
      async execute(args) {
        const existing = ctx.customerState.findRefundByOrder(args.orderId)
        if (existing) throw new EntityAlreadyExistsError(existing.refundId)
        const change = await ctx.customerState.createRefund({
          ...args,
          status: args.status ?? 'pending',
        })
        await ctx.customerEvents.publish(change.event)
        return {
          refundId: change.after.refundId,
          orderId: change.after.orderId,
          amount: change.after.amount,
          status: change.after.status,
          version: change.after.version,
        }
      },
    }),
  ]
}
