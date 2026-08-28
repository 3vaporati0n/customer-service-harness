import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { findLogistics } from './logistics.js'
import {
  findOrder,
  InvalidOrderIdError,
  ORDER_NOT_FOUND_MESSAGE,
} from './orders.js'

const STATUS_LABELS = {
  shipped: '已发货',
  processing: '处理中',
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
          enum: ['shipped', 'processing'],
          required: true,
        },
        logisticsStatus: { type: 'string', required: true },
        estimatedDelivery: { type: 'string', required: true },
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

const LOGISTICS_RESULT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', const: true, required: true },
        orderId: { type: 'string', required: true },
        currentStatus: { type: 'string', required: true },
        events: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              time: { type: 'string', required: true },
              location: { type: 'string', required: true },
              description: { type: 'string', required: true },
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

export const name = 'order-query'
export const inject = ['tools'] as const

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'query_order',
      description: '根据订单号查询订单状态、物流状态和预计送达时间。',
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
            return [
              {
                type: 'text',
                text: `未找到订单 ${value.orderId}，请检查订单号。`,
              },
            ]
          }

          return [
            {
              type: 'text',
              text: `订单 ${value.orderId} 当前状态：${STATUS_LABELS[value.status]}；物流状态：${value.logisticsStatus}；预计送达时间：${value.estimatedDelivery}。`,
            },
          ]
        },
      },
      async execute(args) {
        try {
          return findOrder(args.orderId)
        } catch (error) {
          if (error instanceof InvalidOrderIdError) throw error
          throw new Error('订单查询服务暂时不可用，请稍后重试。', {
            cause: error,
          })
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'query_logistics',
      description: '根据订单号查询当前物流状态和物流轨迹。',
      parameters: {
        orderId: {
          type: 'string',
          required: true,
          description: '需要查询物流轨迹的订单号，例如 ORDER-1001。',
        },
      },
      output: {
        schema: LOGISTICS_RESULT_SCHEMA,
        render: (_args, value) => {
          if (!value.found) {
            return [
              {
                type: 'text',
                text: `未找到订单 ${value.orderId}，请检查订单号。`,
              },
            ]
          }

          const lines = [
            `订单 ${value.orderId} 当前物流状态：${value.currentStatus}。`,
            ...value.events.map(
              (event) =>
                `${event.time}｜${event.location}｜${event.description}`,
            ),
          ]
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        try {
          return findLogistics(args.orderId)
        } catch (error) {
          if (error instanceof InvalidOrderIdError) throw error
          throw new Error('物流查询服务暂时不可用，请稍后重试。', {
            cause: error,
          })
        }
      },
    }),
  )
}
