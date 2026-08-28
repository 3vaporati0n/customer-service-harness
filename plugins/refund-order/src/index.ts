import type { Context } from '@deepseek-ai/cordis'
import {
  defineCustomerTool,
  normalizeBusinessId,
  type Order,
  type Refund,
  type ReturnRequest,
} from '@dsh-customer-service/domain'
import '@dsh-customer-service/approval'
import '@dsh-customer-service/events'
import '@dsh-customer-service/state'

const ACTION = 'refund_order' as const
const CONFIRMATION_MESSAGES = {
  CONFIRMATION_NOT_FOUND: '确认编号不存在。',
  CONFIRMATION_EXPIRED: '确认编号已过期。',
  CONFIRMATION_ACTION_MISMATCH: '确认编号不属于退款操作。',
} as const

function rejection(code: string, message: string) {
  return { accepted: false, code, message } as const
}

function evaluateEligibility(
  orderId: string,
  order: Readonly<Order> | undefined,
  returns: readonly Readonly<ReturnRequest>[],
  refunds: readonly Readonly<Refund>[],
) {
  if (!order) return rejection('ORDER_NOT_FOUND', `未找到订单 ${orderId}。`)
  const activeRefund = refunds
    .find((item) => item.status !== 'failed')
  if (activeRefund) {
    return rejection(
      'REFUND_ALREADY_EXISTS',
      `订单 ${orderId} 已存在退款记录 ${activeRefund.refundId}。`,
    )
  }
  if (order.status === 'cancelled') {
    return { accepted: true, order, returnId: undefined } as const
  }
  const returned = returns
    .find((item) => item.status === 'approved' || item.status === 'received')
  if (!returned) {
    return rejection('REFUND_NOT_ELIGIBLE', `订单 ${orderId} 当前不满足退款条件。`)
  }
  return { accepted: true, order, returnId: returned.returnId } as const
}

function eligibility(ctx: Context, orderId: string) {
  return evaluateEligibility(
    orderId,
    ctx.customerState.getOrder(orderId),
    ctx.customerState.listReturnsByOrder(orderId),
    ctx.customerState.listRefundsByOrder(orderId),
  )
}

function nonBlankReason(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('退款原因不能为空。')
  return value
}

async function withInternalBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw new Error('退款服务暂时不可用，请稍后重试。', { cause: error })
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
      refundId: { type: 'string', required: true },
      returnId: { type: 'string' },
      amount: { type: 'number', required: true },
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
      refundId: { type: 'string', required: true },
      returnId: { type: 'string' },
      amount: { type: 'number', required: true },
      status: { type: 'string', const: 'pending', required: true },
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

export interface RefundOrderOptions {
  idFactory?: () => string
}

export const name = 'customer-refund-order'
export const inject = ['tools', 'customerState', 'customerApproval', 'customerEvents'] as const

export function apply(ctx: Context, options: RefundOrderOptions = {}): void {
  const idFactory = options.idFactory ?? (() => `REFUND-${crypto.randomUUID()}`)

  ctx.tools.register(defineCustomerTool({
    name: 'request_refund',
    description: '预检整单退款资格并按订单总额生成一次性确认编号。',
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
      const refundId = normalizeBusinessId(idFactory())
      const payload = {
        refundId,
        ...(eligible.returnId ? { returnId: eligible.returnId } : {}),
        amount: eligible.order.totalAmount,
        reason,
      }
      const confirmation = ctx.customerApproval.issue({
        action: ACTION, targetId: orderId, payload,
      })
      return {
        accepted: true, action: ACTION, orderId, refundId,
        ...(eligible.returnId ? { returnId: eligible.returnId } : {}),
        amount: eligible.order.totalAmount,
        confirmationId: confirmation.confirmationId,
        expiresAt: confirmation.expiresAt,
        summary: `确认申请订单 ${orderId} 整单退款 ${eligible.order.totalAmount} 元，退款编号 ${refundId}。确认编号：${confirmation.confirmationId}。`,
      } as const
      })
    },
  }))

  ctx.tools.register(defineCustomerTool({
    name: 'confirm_refund',
    description: '使用一次性确认编号创建待处理的整单退款记录。',
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
        const refundId = String(replay.after.refundId)
        const returnId = replay.after.returnId ? String(replay.after.returnId) : undefined
        const amount = Number(replay.after.amount)
        return {
          applied: true, action: ACTION, orderId, refundId,
          ...(returnId ? { returnId } : {}),
          amount, status: 'pending', confirmationId, auditId: replay.auditId,
          alreadyApplied: true,
          message: `订单 ${orderId} 的退款 ${refundId} 已提交，金额 ${amount} 元。`,
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
      const refundId = normalizeBusinessId(String(validation.payload.refundId ?? ''))
      const boundReturnId = validation.payload.returnId
        ? normalizeBusinessId(String(validation.payload.returnId))
        : undefined
      const amount = Number(validation.payload.amount)
      if (boundReturnId !== eligible.returnId || amount !== eligible.order.totalAmount) {
        return {
          applied: false,
          code: 'REFUND_NOT_ELIGIBLE',
          message: `订单 ${validation.targetId} 的退款资格已发生变化。`,
        } as const
      }
      const reason = nonBlankReason(String(validation.payload.reason ?? ''))
      const change = await ctx.customerState.createRefundIf(
        {
          refundId, orderId: validation.targetId,
          ...(boundReturnId ? { returnId: boundReturnId } : {}),
          amount, reason, status: 'pending',
        },
        (order, returns, refunds) => {
          const current = evaluateEligibility(
            validation.targetId,
            order,
            returns,
            refunds,
          )
          return current.accepted
            && current.returnId === boundReturnId
            && current.order.totalAmount === amount
        },
      )
      if (!change) {
        const latest = eligibility(ctx, validation.targetId)
        if (!latest.accepted) {
          return { applied: false, code: latest.code, message: latest.message } as const
        }
        return {
          applied: false,
          code: 'REFUND_NOT_ELIGIBLE',
          message: `订单 ${validation.targetId} 的退款资格已发生变化。`,
        } as const
      }
      const applied = ctx.customerApproval.recordApplied(confirmationId, {
        before: { orderId: validation.targetId, refund: null },
        after: { ...change.after },
      })
      await publishCommitted(() => ctx.customerEvents.publish(change.event))
      return {
        applied: true, action: ACTION, orderId: change.after.orderId,
        refundId: change.after.refundId,
        ...(change.after.returnId ? { returnId: change.after.returnId } : {}),
        amount: change.after.amount, status: 'pending', confirmationId,
        auditId: applied.auditId, alreadyApplied: false,
        message: `订单 ${change.after.orderId} 的退款 ${change.after.refundId} 已提交，金额 ${change.after.amount} 元。`,
      } as const
        },
      ))
    },
  }))
}
