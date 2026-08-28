import type { Context } from '@deepseek-ai/cordis'
import { defineCustomerTool } from '@dsh-customer-service/domain'
import '@dsh-customer-service/state'

const ORDER_NOT_FOUND_MESSAGE = '未找到该订单，请检查订单号。'

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

export class InvalidOrderIdError extends Error {
  constructor() {
    super('订单号不能为空。')
    this.name = 'InvalidOrderIdError'
  }
}

export const name = 'customer-query-logistics'
export const inject = ['tools', 'customerState'] as const

export function apply(ctx: Context) {
  ctx.tools.register(
    defineCustomerTool({
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
            return [{
              type: 'text',
              text: `未找到订单 ${value.orderId}，请检查订单号。`,
            }]
          }
          return [{
            type: 'text',
            text: [
              `订单 ${value.orderId} 当前物流状态：${value.currentStatus}。`,
              ...value.events.map(
                (event) => `${event.time}｜${event.location}｜${event.description}`,
              ),
            ].join('\n'),
          }]
        },
      },
      async execute(args) {
        if (!args.orderId.trim()) throw new InvalidOrderIdError()
        const orderId = args.orderId.trim().toUpperCase()
        try {
          const logistics = ctx.customerState.getLogistics(orderId)
          if (!logistics) {
            return { found: false, orderId, message: ORDER_NOT_FOUND_MESSAGE } as const
          }
          return {
            found: true,
            orderId: logistics.orderId,
            currentStatus: logistics.currentStatus,
            events: logistics.events.map((event) => ({
              time: event.time,
              location: event.location,
              description: event.description,
            })),
          } as const
        } catch (error) {
          throw new Error('物流查询服务暂时不可用，请稍后重试。', { cause: error })
        }
      },
    }),
  )
}
