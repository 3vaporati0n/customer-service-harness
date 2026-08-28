import type { Context } from '@deepseek-ai/cordis'
import {
  defineCustomerTool,
  normalizeBusinessId,
  type Order,
  type ReturnRequest,
} from '@dsh-customer-service/domain'
import '@dsh-customer-service/approval'
import '@dsh-customer-service/events'
import '@dsh-customer-service/state'

const ACTION = 'return_order' as const
const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const CONFIRMATION_MESSAGES = {
  CONFIRMATION_NOT_FOUND: '确认编号不存在。',
  CONFIRMATION_EXPIRED: '确认编号已过期。',
  CONFIRMATION_ACTION_MISMATCH: '确认编号不属于退货操作。',
} as const

function rejection(code: string, message: string) {
  return { accepted: false, code, message } as const
}

function evaluateEligibility(
  orderId: string,
  order: Readonly<Order> | undefined,
  returns: readonly Readonly<ReturnRequest>[],
  now: Date,
) {
  if (!order) return rejection('ORDER_NOT_FOUND', `未找到订单 ${orderId}。`)
  if (order.status !== 'delivered' || !order.deliveredAt) {
    return rejection('ORDER_NOT_DELIVERED', `订单 ${orderId} 尚未签收，不能申请退货。`)
  }
  const deliveredAt = new Date(order.deliveredAt).valueOf()
  const elapsed = now.valueOf() - deliveredAt
  if (!Number.isFinite(deliveredAt) || elapsed < 0 || elapsed > RETURN_WINDOW_MS) {
    return rejection('RETURN_WINDOW_EXPIRED', `订单 ${orderId} 已超过七天退货期限。`)
  }
  const active = returns
    .find((item) => item.status === 'approved' || item.status === 'received')
  if (active) {
    return rejection(
      'RETURN_ALREADY_EXISTS',
      `订单 ${orderId} 已存在活动退货记录 ${active.returnId}。`,
    )
  }
  return { accepted: true, order } as const
}

function eligibility(ctx: Context, orderId: string) {
  return evaluateEligibility(
    orderId,
    ctx.customerState.getOrder(orderId),
    ctx.customerState.listReturnsByOrder(orderId),
    ctx.customerState.clock.now(),
  )
}

function nonBlankReason(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('退货原因不能为空。')
  return value
}

async function withInternalBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw new Error('退货服务暂时不可用，请稍后重试。', { cause: error })
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
    { type: 'object', additionalProperties: false, properties: {
      accepted: { type: 'boolean', const: true, required: true },
      action: { type: 'string', const: ACTION, required: true },
      orderId: { type: 'string', required: true },
      returnId: { type: 'string', required: true },
      confirmationId: { type: 'string', required: true },
      expiresAt: { type: 'string', required: true },
      summary: { type: 'string', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      accepted: { type: 'boolean', const: false, required: true },
      code: { type: 'string', required: true },
      message: { type: 'string', required: true },
    } },
  ],
} as const

const CONFIRM_OUTPUT = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      applied: { type: 'boolean', const: true, required: true },
      action: { type: 'string', const: ACTION, required: true },
      orderId: { type: 'string', required: true },
      returnId: { type: 'string', required: true },
      status: { type: 'string', const: 'approved', required: true },
      confirmationId: { type: 'string', required: true },
      auditId: { type: 'string', required: true },
      alreadyApplied: { type: 'boolean', required: true },
      message: { type: 'string', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      applied: { type: 'boolean', const: false, required: true },
      code: { type: 'string', required: true },
      message: { type: 'string', required: true },
    } },
  ],
} as const

export interface ReturnOrderOptions {
  idFactory?: () => string
}

export const name = 'customer-return-order'
export const inject = ['tools', 'customerState', 'customerApproval', 'customerEvents'] as const

export function apply(ctx: Context, options: ReturnOrderOptions = {}): void {
  const idFactory = options.idFactory ?? (() => `RETURN-${crypto.randomUUID()}`)

  ctx.tools.register(defineCustomerTool({
    name: 'request_return_order',
    description: '预检整单退货资格并生成十分钟有效的一次性确认编号。',
    strictParameters: true,
    parameters: {
      orderId: { type: 'string', required: true },
      reason: { type: 'string', required: true },
    },
    output: {
      schema: REQUEST_OUTPUT,
      render: (_args, value) => [{
        type: 'text', text: value.accepted ? value.summary : value.message,
      }],
    },
    async execute(args) {
      const orderId = normalizeBusinessId(args.orderId)
      const reason = nonBlankReason(args.reason)
      return withInternalBoundary(async () => {
      const eligible = eligibility(ctx, orderId)
      if (!eligible.accepted) return eligible
      const returnId = normalizeBusinessId(idFactory())
      const confirmation = ctx.customerApproval.issue({
        action: ACTION, targetId: orderId, payload: { returnId, reason },
      })
      return {
        accepted: true, action: ACTION, orderId, returnId,
        confirmationId: confirmation.confirmationId,
        expiresAt: confirmation.expiresAt,
        summary: `确认申请订单 ${orderId} 整单退货，退货编号 ${returnId}。确认编号：${confirmation.confirmationId}。`,
      } as const
      })
    },
  }))

  ctx.tools.register(defineCustomerTool({
    name: 'confirm_return_order',
    description: '使用一次性确认编号创建已批准的整单退货记录。',
    strictParameters: true,
    parameters: { confirmationId: { type: 'string', required: true } },
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
        const returnId = String(replay.after.returnId)
        return {
          applied: true, action: ACTION, orderId, returnId, status: 'approved',
          confirmationId, auditId: replay.auditId, alreadyApplied: true,
          message: `订单 ${orderId} 的退货记录 ${returnId} 已批准。`,
        } as const
      }
      const validation = ctx.customerApproval.validate(confirmationId, ACTION)
      if (!validation.valid) {
        return {
          applied: false, code: validation.code,
          message: CONFIRMATION_MESSAGES[validation.code],
        } as const
      }
      const eligible = eligibility(ctx, validation.targetId)
      if (!eligible.accepted) {
        return { applied: false, code: eligible.code, message: eligible.message } as const
      }
      const returnId = normalizeBusinessId(String(validation.payload.returnId ?? ''))
      const reason = nonBlankReason(String(validation.payload.reason ?? ''))
      const change = await ctx.customerState.createReturnIf(
        { returnId, orderId: validation.targetId, reason, status: 'approved' },
        (order, returns) => evaluateEligibility(
          validation.targetId,
          order,
          returns,
          ctx.customerState.clock.now(),
        ).accepted,
      )
      if (!change) {
        const latest = eligibility(ctx, validation.targetId)
        if (!latest.accepted) {
          return { applied: false, code: latest.code, message: latest.message } as const
        }
        return {
          applied: false,
          code: 'RETURN_ALREADY_EXISTS',
          message: `订单 ${validation.targetId} 已存在活动退货记录。`,
        } as const
      }
      const applied = ctx.customerApproval.recordApplied(confirmationId, {
        before: { orderId: validation.targetId, return: null },
        after: { ...change.after },
      })
      await publishCommitted(() => ctx.customerEvents.publish(change.event))
      return {
        applied: true, action: ACTION, orderId: change.after.orderId,
        returnId: change.after.returnId, status: 'approved', confirmationId,
        auditId: applied.auditId, alreadyApplied: false,
        message: `订单 ${change.after.orderId} 的退货记录 ${change.after.returnId} 已批准。`,
      } as const
        },
      ))
    },
  }))
}
