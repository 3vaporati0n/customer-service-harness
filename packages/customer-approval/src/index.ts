import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import {
  normalizeBusinessId,
  type ActionConfirmation,
  type AuditRecord,
  type Clock,
  type CustomerAction,
} from '@dsh-customer-service/domain'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customerApproval: CustomerApprovalService
  }
}

export const APPROVAL_TOOL_NAMES = new Set([
  'confirm_cancel_order',
  'confirm_return_order',
  'confirm_refund',
  'confirm_address_change',
])

export type ConfirmationValidation =
  | {
      valid: true
      targetId: string
      payload: Readonly<Record<string, unknown>>
    }
  | {
      valid: false
      code:
        | 'CONFIRMATION_NOT_FOUND'
        | 'CONFIRMATION_EXPIRED'
        | 'CONFIRMATION_ACTION_MISMATCH'
    }

export interface AppliedResult {
  auditId: string
  confirmationId: string
  before: Readonly<Record<string, unknown>>
  after: Readonly<Record<string, unknown>>
  alreadyApplied: boolean
}

export interface CustomerApprovalOptions {
  clock?: Clock
  idFactory?: () => string
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

export function requiresHarnessApproval(name: string): boolean {
  return APPROVAL_TOOL_NAMES.has(name)
}

export async function decideHarnessApproval(
  name: string,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  if (requiresHarnessApproval(name)) {
    return {
      kind: 'ask',
      reason: '该操作将修改客服业务数据。',
    } satisfies PreToolDecision
  }
  return next()
}

export class CustomerApprovalService {
  readonly #confirmations = new Map<string, ActionConfirmation>()
  readonly #audits = new Map<string, AuditRecord>()
  readonly #applied = new Map<string, AppliedResult>()
  readonly #queues = new Map<string, Promise<void>>()
  readonly #reservedAuditIds = new Map<string, string>()
  readonly #clock: Clock
  readonly #idFactory: () => string

  constructor(ctx: Context, options: CustomerApprovalOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() }
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID())
    ctx.on('tools/pre-execute', (execution, next) =>
      decideHarnessApproval(execution.name, next),
    )
  }

  issue(input: {
    action: CustomerAction
    targetId: string
    payload: Readonly<Record<string, unknown>>
  }): ActionConfirmation {
    const created = this.#clock.now()
    const confirmation: ActionConfirmation = {
      confirmationId: normalizeBusinessId(this.#idFactory()),
      action: input.action,
      targetId: normalizeBusinessId(input.targetId),
      payload: deepFreeze(clone(input.payload)),
      createdAt: created.toISOString(),
      expiresAt: new Date(created.valueOf() + 10 * 60_000).toISOString(),
    }
    this.#confirmations.set(confirmation.confirmationId, deepFreeze(clone(confirmation)))
    return clone(confirmation)
  }

  validate(
    confirmationId: string,
    expectedAction: CustomerAction,
  ): ConfirmationValidation {
    const id = normalizeBusinessId(confirmationId)
    const confirmation = this.#confirmations.get(id)
    if (!confirmation) return { valid: false, code: 'CONFIRMATION_NOT_FOUND' }
    if (confirmation.action !== expectedAction) {
      return { valid: false, code: 'CONFIRMATION_ACTION_MISMATCH' }
    }
    if (this.#clock.now().valueOf() >= new Date(confirmation.expiresAt).valueOf()) {
      return { valid: false, code: 'CONFIRMATION_EXPIRED' }
    }
    return {
      valid: true,
      targetId: confirmation.targetId,
      payload: clone(confirmation.payload),
    }
  }

  withConfirmation<T>(
    confirmationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const id = normalizeBusinessId(confirmationId)
    const previous = this.#queues.get(id) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      if (
        this.#confirmations.has(id)
        && !this.#applied.has(id)
        && !this.#reservedAuditIds.has(id)
      ) {
        this.#reservedAuditIds.set(id, normalizeBusinessId(this.#idFactory()))
      }
      try {
        return await operation()
      } finally {
        if (!this.#applied.has(id)) this.#reservedAuditIds.delete(id)
      }
    })
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(id, tail)
    return run.finally(() => {
      if (this.#queues.get(id) === tail) this.#queues.delete(id)
    })
  }

  recordApplied(
    confirmationId: string,
    change: {
      before: Readonly<Record<string, unknown>>
      after: Readonly<Record<string, unknown>>
    },
  ): AppliedResult {
    const id = normalizeBusinessId(confirmationId)
    const existing = this.#applied.get(id)
    if (existing) return { ...clone(existing), alreadyApplied: true }

    const confirmation = this.#confirmations.get(id)
    if (!confirmation) throw new Error('确认编号不存在。')

    const occurredAt = this.#clock.now().toISOString()
    const audit: AuditRecord = deepFreeze({
      auditId: this.#reservedAuditIds.get(id) ?? normalizeBusinessId(this.#idFactory()),
      action: confirmation.action,
      targetId: confirmation.targetId,
      before: clone(change.before),
      after: clone(change.after),
      occurredAt,
    })
    const applied: AppliedResult = deepFreeze({
      auditId: audit.auditId,
      confirmationId: id,
      before: clone(audit.before),
      after: clone(audit.after),
      alreadyApplied: false,
    })
    this.#audits.set(audit.auditId, audit)
    this.#applied.set(id, applied)
    this.#reservedAuditIds.delete(id)
    this.#confirmations.set(id, deepFreeze({
      ...clone(confirmation),
      consumedAt: occurredAt,
      auditId: audit.auditId,
    }))
    return clone(applied)
  }

  getApplied(
    confirmationId: string,
    expectedAction: CustomerAction,
  ): AppliedResult | undefined {
    const id = normalizeBusinessId(confirmationId)
    const confirmation = this.#confirmations.get(id)
    if (!confirmation || confirmation.action !== expectedAction) return undefined
    const applied = this.#applied.get(id)
    return applied ? clone(applied) : undefined
  }

  getAudit(auditId: string): AuditRecord | undefined {
    const audit = this.#audits.get(normalizeBusinessId(auditId))
    return audit ? clone(audit) : undefined
  }
}

export const name = 'customer-approval'
export const inject = ['tools'] as const

export function apply(ctx: Context, options: CustomerApprovalOptions = {}) {
  ctx.reflect.provide('customerApproval', new CustomerApprovalService(ctx, options))
}
