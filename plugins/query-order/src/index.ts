import type { Context } from '@deepseek-ai/cordis'
import { defineCustomerTool } from '@dsh-customer-service/domain'
import '@dsh-customer-service/state'

const ORDER_NOT_FOUND_MESSAGE = '未找到该订单，请检查订单号。'

const STATUS_LABELS = {
  shipped: '已发货',
  processing: '处理中',
  delivered: '已签收',
  cancelled: '已取消',
} as const

const ORDER_RESULT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', const: true, required: true },
        orderId: { type: 'string', required: true },
        status: {
          type: 'string',
          enum: ['shipped', 'processing', 'delivered', 'cancelled'],
          required: true,
        },
        logisticsStatus: { type: 'string', required: true },
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
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', const: false, required: true },
        orderId: { type: 'string', required: true },
        message: {
          type: 'string',
          const: ORDER_NOT_FOUND_MESSAGE,
          required: true,
        },
      },
    },
  ],
} as const

export class InvalidOrderIdError extends Error {
  constructor() {
    super('订单号不能为空。')
    this.name = 'InvalidOrderIdError'
  }
}

export const name = 'customer-query-order'
export const inject = ['tools', 'customerState'] as const

export function apply(ctx: Context) {
  ctx.tools.register(
    defineCustomerTool({
      name: 'query_order',
      description: '根据订单号查询订单状态、物流状态、预计送达时间和商品 SKU 明细。',
      parameters: {
        orderId: {
          type: 'string',
          required: true,
          description: '需要查询的订单号，例如 ORDER-1001。',
        },
      },
      output: {
        schema: ORDER_RESULT_SCHEMA,
        render: (_args, value) => {
          if (!value.found) {
            return [{
              type: 'text',
              text: `未找到订单 ${value.orderId}，请检查订单号。`,
            }]
          }
          const items = value.items
            .map((item) => `${item.sku} ×${item.quantity}（单价 ${item.unitPrice} 元）`)
            .join('、')
          return [{
            type: 'text',
            text: `订单 ${value.orderId} 当前状态：${STATUS_LABELS[value.status]}；物流状态：${value.logisticsStatus}；预计送达时间：${value.estimatedDelivery}。商品：${items}。`,
          }]
        },
      },
      async execute(args) {
        if (!args.orderId.trim()) throw new InvalidOrderIdError()
        const orderId = args.orderId.trim().toUpperCase()
        try {
          const order = ctx.customerState.getOrder(orderId)
          if (!order) {
            return { found: false, orderId, message: ORDER_NOT_FOUND_MESSAGE } as const
          }
          const logistics = ctx.customerState.getLogistics(orderId)
          if (!logistics) throw new Error(`订单 ${orderId} 缺少物流快照。`)
          return {
            found: true,
            orderId: order.orderId,
            status: order.status,
            logisticsStatus: logistics.currentStatus,
            estimatedDelivery: order.estimatedDelivery,
            items: order.items.map(({ sku, quantity, unitPrice }) => ({
              sku,
              quantity,
              unitPrice,
            })),
          }
        } catch (error) {
          throw new Error('订单查询服务暂时不可用，请稍后重试。', { cause: error })
        }
      },
    }),
  )
}
