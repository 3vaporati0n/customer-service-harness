import type { Context } from '@deepseek-ai/cordis'
import {
  normalizeBusinessId,
  type AlertSubscription,
  type AlertType,
  type Clock,
  type CustomerDomainEvent,
} from '@dsh-customer-service/domain'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customerEvents: CustomerEventsService
  }
}

export interface AlertMatch {
  readonly subscriptionId: string
  readonly message: string
  readonly fingerprint: string
}

export interface DeliveryRecord {
  readonly subscriptionId: string
  readonly eventId: string
  readonly status: 'delivered' | 'delivery_failed'
  readonly message: string
}

export type AlertMatcher = (
  event: CustomerDomainEvent,
  subscriptions: readonly AlertSubscription[],
) => readonly AlertMatch[]

export interface CustomerEventsOptions {
  clock?: Clock
  idFactory?: () => string
  resolveAgent?: (id: string) => CustomerFollowupAgent | undefined
}

export interface CustomerFollowupAgent {
  followup(message: {
    id: string
    role: 'user'
    content: readonly [{ type: 'text'; text: string }]
    source: {
      kind: 'plugin'
      plugin: '@dsh-customer-service/events'
      form: 'notice'
      summary: '客服主动提醒'
    }
  }): unknown
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class CustomerEventsService {
  readonly #subscriptions = new Map<string, AlertSubscription>()
  readonly #matchers = new Map<AlertType, AlertMatcher>()
  readonly #seenDeliveries = new Set<string>()
  readonly #deliveryRecords: DeliveryRecord[] = []
  readonly #clock: Clock
  readonly #idFactory: () => string
  readonly #resolveAgent: (id: string) => CustomerFollowupAgent | undefined

  constructor(ctx: Context, options: CustomerEventsOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() }
    this.#idFactory = options.idFactory ?? (() => `SUB-${crypto.randomUUID()}`)
    this.#resolveAgent = options.resolveAgent ?? ((id) => (
      ctx as unknown as { agents: { get(id: string): CustomerFollowupAgent | undefined } }
    ).agents.get(id))
  }

  subscribe(input: {
    sessionId: string
    alertType: AlertType
    targetId: string
  }): AlertSubscription {
    const targetId = normalizeBusinessId(input.targetId)
    const duplicate = [...this.#subscriptions.values()].find(
      (item) =>
        item.active &&
        item.sessionId === input.sessionId &&
        item.alertType === input.alertType &&
        item.targetId === targetId,
    )
    if (duplicate) return clone(duplicate)

    const subscription: AlertSubscription = {
      subscriptionId: this.#idFactory(),
      sessionId: input.sessionId,
      alertType: input.alertType,
      targetId,
      active: true,
      createdAt: this.#clock.now().toISOString(),
    }
    this.#subscriptions.set(subscription.subscriptionId, clone(subscription))
    return clone(subscription)
  }

  list(sessionId: string): AlertSubscription[] {
    return [...this.#subscriptions.values()]
      .filter((item) => item.sessionId === sessionId)
      .map(clone)
  }

  cancel(sessionId: string, subscriptionId: string): boolean {
    const subscription = this.#subscriptions.get(subscriptionId)
    if (!subscription || subscription.sessionId !== sessionId || !subscription.active) {
      return false
    }
    this.#subscriptions.set(subscriptionId, { ...subscription, active: false })
    return true
  }

  registerMatcher(alertType: AlertType, matcher: AlertMatcher): () => void {
    if (this.#matchers.has(alertType)) {
      throw new Error(`提醒类型 ${alertType} 已注册匹配器。`)
    }
    this.#matchers.set(alertType, matcher)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.#matchers.get(alertType) === matcher) this.#matchers.delete(alertType)
    }
  }

  async publish(event: CustomerDomainEvent): Promise<DeliveryRecord[]> {
    const records: DeliveryRecord[] = []
    for (const [alertType, matcher] of this.#matchers) {
      const subscriptions = [...this.#subscriptions.values()]
        .filter((item) => item.active && item.alertType === alertType)
        .map(clone)
      if (subscriptions.length === 0) continue

      const eligible = new Map(
        subscriptions.map((item) => [item.subscriptionId, item]),
      )
      const matchedInCall = new Set<string>()
      for (const match of matcher(clone(event), subscriptions)) {
        const subscription = eligible.get(match.subscriptionId)
        if (!subscription || matchedInCall.has(match.subscriptionId)) continue
        matchedInCall.add(match.subscriptionId)

        const eventKey = `${subscription.subscriptionId}:${event.eventId}`
        if (this.#seenDeliveries.has(eventKey)) continue
        this.#seenDeliveries.add(eventKey)
        if (subscription.lastTriggeredFingerprint === match.fingerprint) continue

        const record = this.#deliver(subscription, event, match)
        this.#deliveryRecords.push(clone(record))
        records.push(record)
        if (record.status === 'delivered') {
          this.#subscriptions.set(subscription.subscriptionId, {
            ...subscription,
            lastTriggeredVersion: event.version,
            lastTriggeredFingerprint: match.fingerprint,
          })
        }
      }
    }
    return records.map(clone)
  }

  #deliver(
    subscription: AlertSubscription,
    event: CustomerDomainEvent,
    match: AlertMatch,
  ): DeliveryRecord {
    const agent = this.#resolveAgent(subscription.sessionId)
    const base = {
      subscriptionId: subscription.subscriptionId,
      eventId: event.eventId,
      message: match.message,
    }
    if (!agent) return { ...base, status: 'delivery_failed' }

    try {
      agent.followup({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: match.message }],
        source: {
          kind: 'plugin',
          plugin: '@dsh-customer-service/events',
          form: 'notice',
          summary: '客服主动提醒',
        },
      })
      return { ...base, status: 'delivered' }
    } catch {
      return { ...base, status: 'delivery_failed' }
    }
  }
}

export const name = 'customer-events'
export const inject = ['agents'] as const

export function apply(ctx: Context, options: CustomerEventsOptions = {}) {
  ctx.reflect.provide('customerEvents', new CustomerEventsService(ctx, options))
}
