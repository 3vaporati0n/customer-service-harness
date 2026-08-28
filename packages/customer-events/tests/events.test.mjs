import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { MutableClock } from '@dsh-customer-service/domain'
import { CustomerEventsService } from '../src/index.ts'

function createFixture(agentIds = ['SESSION-A']) {
  const messages = new Map(agentIds.map((id) => [id, []]))
  const agents = new Map(
    agentIds.map((id) => [
      id,
      {
        id,
        followup(message) {
          messages.get(id).push(message)
        },
      },
    ]),
  )
  let id = 0
  const events = new CustomerEventsService(new Context(), {
    clock: new MutableClock('2026-08-27T12:00:00+08:00'),
    idFactory: () => `SUB-${++id}`,
    resolveAgent: (sessionId) => agents.get(sessionId),
  })
  return { agents, events, messages }
}

const inventoryEvent = {
  eventId: 'EVENT-1',
  type: 'inventory.changed',
  entityId: 'SKU-1002',
  version: 2,
  occurredAt: '2026-08-27T04:00:00.000Z',
  payload: {
    before: { stock: 0, version: 1 },
    after: { stock: 5, version: 2 },
  },
}

describe('customerEvents service', () => {
  it('deduplicates subscriptions while preserving session isolation', () => {
    const { events } = createFixture(['SESSION-A', 'SESSION-B'])
    const first = events.subscribe({
      sessionId: 'SESSION-A',
      alertType: 'product_restock',
      targetId: 'SKU-1002',
    })
    const duplicate = events.subscribe({
      sessionId: 'SESSION-A',
      alertType: 'product_restock',
      targetId: ' sku-1002 ',
    })
    expect(duplicate.subscriptionId).toBe(first.subscriptionId)
    expect(events.list('SESSION-B')).toEqual([])
    expect(events.cancel('SESSION-B', first.subscriptionId)).toBe(false)
    expect(events.cancel('SESSION-A', first.subscriptionId)).toBe(true)
    expect(events.list('SESSION-A')[0].active).toBe(false)
  })

  it('delivers one plugin notice and suppresses repeated event and fingerprint', async () => {
    const { events, messages } = createFixture()
    const subscription = events.subscribe({
      sessionId: 'SESSION-A',
      alertType: 'product_restock',
      targetId: 'SKU-1002',
    })
    events.registerMatcher('product_restock', (event, subscriptions) => {
      if (event.type !== 'inventory.changed') return []
      return subscriptions
        .filter((item) => item.targetId === event.entityId)
        .map((item) => ({
          subscriptionId: item.subscriptionId,
          message: '商品 SKU-1002 已补货。',
          fingerprint: `inventory:${event.version}`,
        }))
    })

    const first = await events.publish(inventoryEvent)
    const repeatedEvent = await events.publish(inventoryEvent)
    const repeatedFingerprint = await events.publish({
      ...inventoryEvent,
      eventId: 'EVENT-2',
    })

    expect(first).toEqual([
      {
        subscriptionId: subscription.subscriptionId,
        eventId: 'EVENT-1',
        status: 'delivered',
        message: '商品 SKU-1002 已补货。',
      },
    ])
    expect(repeatedEvent).toEqual([])
    expect(repeatedFingerprint).toEqual([])
    expect(messages.get('SESSION-A')).toHaveLength(1)
    expect(messages.get('SESSION-A')[0]).toMatchObject({
      role: 'user',
      source: {
        kind: 'plugin',
        plugin: '@dsh-customer-service/events',
        form: 'notice',
        summary: '客服主动提醒',
      },
      content: [{ type: 'text', text: '商品 SKU-1002 已补货。' }],
    })
  })

  it('records delivery failure when the bound agent is gone', async () => {
    const { agents, events } = createFixture()
    const subscription = events.subscribe({
      sessionId: 'SESSION-A',
      alertType: 'product_restock',
      targetId: 'SKU-1002',
    })
    events.registerMatcher('product_restock', () => [{
      subscriptionId: subscription.subscriptionId,
      message: '商品 SKU-1002 已补货。',
      fingerprint: 'inventory:2',
    }])
    agents.delete('SESSION-A')

    expect(await events.publish(inventoryEvent)).toEqual([
      {
        subscriptionId: subscription.subscriptionId,
        eventId: 'EVENT-1',
        status: 'delivery_failed',
        message: '商品 SKU-1002 已补货。',
      },
    ])
  })

  it('owns exactly one matcher per alert type and disposes it precisely', () => {
    const { events } = createFixture()
    const dispose = events.registerMatcher('delivery', () => [])
    expect(() => events.registerMatcher('delivery', () => []))
      .toThrow('提醒类型 delivery 已注册匹配器。')
    dispose()
    expect(() => events.registerMatcher('delivery', () => [])).not.toThrow()
  })
})
