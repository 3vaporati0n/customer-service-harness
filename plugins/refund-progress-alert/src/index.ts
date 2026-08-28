import type { Context } from '@deepseek-ai/cordis'
import {
  defineCustomerTool,
  normalizeBusinessId,
  type Refund,
  type RefundStatus,
} from '@dsh-customer-service/domain'
import '@dsh-customer-service/events'
import '@dsh-customer-service/state'

const STATUS_LABELS: Readonly<Record<RefundStatus, string>> = {
  pending: '待处理',
  processing: '处理中',
  succeeded: '退款成功',
  failed: '退款失败',
}

const SUBSCRIPTION_RESULT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        subscribed: { type: 'boolean', const: true, required: true },
        subscriptionId: { type: 'string', required: true },
        targetType: { type: 'string', const: 'refund', required: true },
        targetId: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        subscribed: { type: 'boolean', const: false, required: true },
        code: {
          type: 'string',
          enum: ['REFUND_NOT_FOUND', 'ALERT_SESSION_REQUIRED'],
          required: true,
        },
        message: { type: 'string', required: true },
      },
    },
  ],
} as const

function refundFromPayload(value: unknown): Refund | null {
  if (!value || typeof value !== 'object') return null
  const refund = value as Partial<Refund>
  return typeof refund.refundId === 'string' && typeof refund.status === 'string'
    ? refund as Refund
    : null
}

export const name = 'customer-refund-progress-alert'
export const inject = ['tools', 'customerState', 'customerEvents'] as const

export function apply(ctx: Context) {
  ctx.customerEvents.registerMatcher('refund_progress', (event, subscriptions) => {
    if (event.type !== 'refund.updated') return []
    const before = refundFromPayload(event.payload.before)
    const after = refundFromPayload(event.payload.after)
    if (!before || !after || before.status === after.status) return []

    return subscriptions
      .filter((subscription) => subscription.targetId === event.entityId)
      .map((subscription) => ({
        subscriptionId: subscription.subscriptionId,
        message: `退款 ${event.entityId} 状态已更新为：${STATUS_LABELS[after.status]}。`,
        fingerprint: `refund-status:${after.status}`,
      }))
  })

  ctx.tools.register(
    defineCustomerTool({
      name: 'subscribe_refund_progress_alert',
      description: '订阅指定退款的进度变化提醒；退款状态变化后主动通知当前 Harness 会话。',
      strictParameters: true,
      parameters: {
        refundId: {
          type: 'string',
          required: true,
          description: '需要关注的退款编号，例如 REFUND-1234。',
        },
      },
      output: {
        schema: SUBSCRIPTION_RESULT_SCHEMA,
        render: (_args, value) => [{
          type: 'text',
          text: value.subscribed
            ? `已订阅退款 ${value.targetId} 的进度变化；状态更新后会在当前会话主动提醒。`
            : value.message,
        }],
      },
      async execute(args, exec) {
        const refundId = normalizeBusinessId(args.refundId)
        const sessionId = exec.agent?.id
        if (!sessionId) {
          return {
            subscribed: false,
            code: 'ALERT_SESSION_REQUIRED',
            message: '当前会话无法订阅退款提醒，请在 Harness 会话中重试。',
          } as const
        }
        if (!ctx.customerState.getRefund(refundId)) {
          return {
            subscribed: false,
            code: 'REFUND_NOT_FOUND',
            message: `未找到退款 ${refundId}。`,
          } as const
        }
        const subscription = ctx.customerEvents.subscribe({
          sessionId,
          alertType: 'refund_progress',
          targetId: refundId,
        })
        return {
          subscribed: true,
          subscriptionId: subscription.subscriptionId,
          targetType: 'refund',
          targetId: refundId,
        } as const
      },
    }),
  )
}
