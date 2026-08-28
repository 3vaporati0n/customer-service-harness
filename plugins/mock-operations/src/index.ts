import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import {
  defineCustomerTool,
  type LogisticsStatus,
  type RefundStatus,
} from '@dsh-customer-service/domain'
import '@dsh-customer-service/events'
import '@dsh-customer-service/state'

const MOCK_TOOL_NAMES = new Set([
  'mock_set_inventory',
  'mock_append_logistics_event',
  'mock_set_refund_status',
  'mock_advance_clock',
])

const LOGISTICS_LABELS: Record<LogisticsStatus, string> = {
  pending_shipment: '待发货',
  in_transit: '运输中',
  delivered: '已签收',
  delivery_failed: '配送失败',
}

const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  succeeded: '退款成功',
  failed: '退款失败',
}

export async function decideMockApproval(
  name: string,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  if (MOCK_TOOL_NAMES.has(name)) {
    return {
      kind: 'ask',
      reason: '该演示操作将修改本地验收业务数据。',
    } satisfies PreToolDecision
  }
  return next()
}

export const name = 'customer-mock-operations'
export const inject = ['tools', 'customerState', 'customerEvents'] as const

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', (execution, next) =>
    decideMockApproval(execution.name, next),
  )

  ctx.tools.register(
    defineCustomerTool({
      name: 'mock_set_inventory',
      description: '仅用于本地演示：把指定 SKU 的验收库存设置为目标数量。',
      parameters: {
        sku: { type: 'string', required: true },
        stock: { type: 'integer', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sku: { type: 'string', required: true },
            beforeStock: { type: 'integer', required: true },
            afterStock: { type: 'integer', required: true },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `商品 ${value.sku} 库存已从 ${value.beforeStock} 调整为 ${value.afterStock}。`,
        }],
      },
      async execute(args) {
        if (args.stock < 0) throw new Error('库存不能小于 0。')
        const change = await ctx.customerState.updateInventory(
          args.sku,
          () => ({ stock: args.stock }),
        )
        await ctx.customerEvents.publish(change.event)
        return {
          sku: change.after.sku,
          beforeStock: change.before!.stock,
          afterStock: change.after.stock,
          version: change.after.version,
        }
      },
    }),
  )

  ctx.tools.register(
    defineCustomerTool({
      name: 'mock_append_logistics_event',
      description: '仅用于本地演示：追加物流轨迹并更新物流状态。',
      parameters: {
        orderId: { type: 'string', required: true },
        status: {
          type: 'string',
          enum: ['pending_shipment', 'in_transit', 'delivered', 'delivery_failed'],
          required: true,
        },
        time: { type: 'string', required: true },
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
          text: `订单 ${value.orderId} 已追加物流轨迹，当前状态：${value.currentStatus}。`,
        }],
      },
      async execute(args) {
        const change = await ctx.customerState.updateLogistics(
          args.orderId,
          (current) => ({
            status: args.status,
            currentStatus: LOGISTICS_LABELS[args.status],
            events: [
              ...current.events,
              {
                time: args.time,
                location: args.location,
                description: args.description,
              },
            ],
          }),
        )
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
  )

  ctx.tools.register(
    defineCustomerTool({
      name: 'mock_set_refund_status',
      description: '仅用于本地验收：把指定退款记录更新为目标处理状态。',
      strictParameters: true,
      parameters: {
        refundId: { type: 'string', required: true },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'succeeded', 'failed'],
          required: true,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            refundId: { type: 'string', required: true },
            beforeStatus: {
              type: 'string',
              enum: ['pending', 'processing', 'succeeded', 'failed'],
              required: true,
            },
            afterStatus: {
              type: 'string',
              enum: ['pending', 'processing', 'succeeded', 'failed'],
              required: true,
            },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `退款 ${value.refundId} 已从${REFUND_STATUS_LABELS[value.beforeStatus]}更新为${REFUND_STATUS_LABELS[value.afterStatus]}。`,
        }],
      },
      async execute(args) {
        const change = await ctx.customerState.updateRefund(
          args.refundId,
          () => ({ status: args.status }),
        )
        await ctx.customerEvents.publish(change.event)
        return {
          refundId: change.after.refundId,
          beforeStatus: change.before!.status,
          afterStatus: change.after.status,
          version: change.after.version,
        }
      },
    }),
  )

  ctx.tools.register(
    defineCustomerTool({
      name: 'mock_advance_clock',
      description: '仅用于本地演示：前进确定性内存时钟。',
      parameters: {
        hours: { type: 'number', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            before: { type: 'string', required: true },
            after: { type: 'string', required: true },
            version: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `演示时钟已从 ${value.before} 前进到 ${value.after}。`,
        }],
      },
      async execute(args) {
        const change = await ctx.customerState.advanceClock(args.hours)
        await ctx.customerEvents.publish(change.event)
        return {
          before: change.before,
          after: change.after,
          version: change.event.version,
        }
      },
    }),
  )
}
