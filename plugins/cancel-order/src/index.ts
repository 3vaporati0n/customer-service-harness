import type { Context } from '@deepseek-ai/cordis'
import { defineCustomerTool, normalizeBusinessId } from '@dsh-customer-service/domain'
import '@dsh-customer-service/approval'
import '@dsh-customer-service/events'
import '@dsh-customer-service/state'

const ACTION = 'cancel_order' as const

const CONFIRMATION_MESSAGES = {
  CONFIRMATION_NOT_FOUND: '确认编号不存在。',
  CONFIRMATION_EXPIRED: '确认编号已过期。',
  CONFIRMATION_ACTION_MISMATCH: '确认编号不属于取消订单操作。',
} as const

function rejection(orderId: string, status?: string) {
  if (!status) {
    return { accepted: false, code: 'ORDER_NOT_FOUND', message: `未找到订单 ${orderId}。` } as const
  }
  return {
    accepted: false,
    code: 'ORDER_ALREADY_SHIPPED',
    message: `订单 ${orderId} 当前状态不允许取消。`,
  } as const
}

function eligibility(ctx: Context, orderId: string) {
  const order = ctx.customerState.getOrder(orderId)
  if (!order) return rejection(orderId)
  if (order.status !== 'processing') return rejection(orderId, order.status)
  return { accepted: true, order } as const
}

function nonBlankReason(raw: string): string {
  const reason = raw.trim()
  if (!reason) throw new Error('取消原因不能为空。')
  return reason
}

async function withInternalBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw new Error('取消订单服务暂时不可用，请稍后重试。', { cause: error })
  }
}

async function publishCommitted(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation()
  } catch {
    // The state and audit are already committed; replay remains the source of truth.
  }
}

const REQUEST_OUTPUT = {
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: {
        accepted: { type: 'boolean', const: true, required: true },
        action: { type: 'string', const: ACTION, required: true },
        orderId: { type: 'string', required: true },
        confirmationId: { type: 'string', required: true },
        expiresAt: { type: 'string', required: true },
        summary: { type: 'string', required: true },
      },
    },
    {
      type: 'object', additionalProperties: false,
      properties: {
        accepted: { type: 'boolean', const: false, required: true },
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
  ],
} as const

const CONFIRM_OUTPUT = {
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: {
        applied: { type: 'boolean', const: true, required: true },
        action: { type: 'string', const: ACTION, required: true },
        orderId: { type: 'string', required: true },
        confirmationId: { type: 'string', required: true },
        auditId: { type: 'string', required: true },
        alreadyApplied: { type: 'boolean', required: true },
        message: { type: 'string', required: true },
      },
    },
    {
      type: 'object', additionalProperties: false,
      properties: {
        applied: { type: 'boolean', const: false, required: true },
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
  ],
} as const

export const name = 'customer-cancel-order'
export const inject = ['tools', 'customerState', 'customerApproval', 'customerEvents'] as const

export function apply(ctx: Context): void {
  ctx.tools.register(defineCustomerTool({
    name: 'request_cancel_order',
    description: '预检整单取消资格并生成十分钟有效的一次性确认编号。',
    strictParameters: true,
    parameters: {
      orderId: { type: 'string', required: true },
      reason: { type: 'string', required: true },
    },
    output: {
      schema: REQUEST_OUTPUT,
      render: (_args, value) => [{
        type: 'text',
        text: value.accepted ? value.summary : value.message,
      }],
    },
    async execute(args) {
      const orderId = normalizeBusinessId(args.orderId)
      const reason = nonBlankReason(args.reason)
      return withInternalBoundary(async () => {
      const eligible = eligibility(ctx, orderId)
      if (!eligible.accepted) return eligible
      const confirmation = ctx.customerApproval.issue({
        action: ACTION,
        targetId: orderId,
        payload: { reason },
      })
      return {
        accepted: true,
        action: ACTION,
        orderId,
        confirmationId: confirmation.confirmationId,
        expiresAt: confirmation.expiresAt,
        summary: `确认取消订单 ${orderId}，原因：${reason}。确认编号：${confirmation.confirmationId}。`,
      } as const
      })
    },
  }))

  ctx.tools.register(defineCustomerTool({
    name: 'confirm_cancel_order',
    description: '使用一次性确认编号执行整单取消。',
    strictParameters: true,
    parameters: {
      confirmationId: { type: 'string', required: true },
    },
    output: {
      schema: CONFIRM_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const confirmationId = normalizeBusinessId(args.confirmationId)
      return withInternalBoundary(() => ctx.customerApproval.withConfirmation(
        confirmationId,
        async () => {
      const replay = ctx.customerApproval.getApplied(confirmationId, ACTION)
      if (replay) {
        const orderId = String(replay.after.orderId)
        return {
          applied: true,
          action: ACTION,
          orderId,
          confirmationId,
          auditId: replay.auditId,
          alreadyApplied: true,
          message: `订单 ${orderId} 已取消。`,
        } as const
      }

      const validation = ctx.customerApproval.validate(confirmationId, ACTION)
      if (!validation.valid) {
        return {
          applied: false,
          code: validation.code,
          message: CONFIRMATION_MESSAGES[validation.code],
        } as const
      }
      const eligible = eligibility(ctx, validation.targetId)
      if (!eligible.accepted) {
        return { applied: false, code: eligible.code, message: eligible.message } as const
      }
      const change = await ctx.customerState.updateOrderIf(
        validation.targetId,
        (current) => current.status === 'processing',
        () => ({ status: 'cancelled' }),
      )
      if (!change) {
        const latest = eligibility(ctx, validation.targetId)
        return {
          applied: false,
          code: latest.accepted ? 'ORDER_ALREADY_SHIPPED' : latest.code,
          message: latest.accepted
            ? `订单 ${validation.targetId} 当前状态不允许取消。`
            : latest.message,
        } as const
      }
      const applied = ctx.customerApproval.recordApplied(confirmationId, {
        before: { ...change.before! },
        after: { ...change.after },
      })
      await publishCommitted(() => ctx.customerEvents.publish(change.event))
      return {
        applied: true,
        action: ACTION,
        orderId: change.after.orderId,
        confirmationId,
        auditId: applied.auditId,
        alreadyApplied: false,
        message: `订单 ${change.after.orderId} 已取消。`,
      } as const
        },
      ))
    },
  }))
}
