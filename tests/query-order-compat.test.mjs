import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { CustomerStateService } from '@dsh-customer-service/state'
import { apply as applyNew } from '../plugins/query-order/src/index.ts'
import { apply as applyLegacy } from '../legacy/dsh-plugin-order-query/src/index.ts'

function registeredTool(apply, context, name) {
  const tools = new Map()
  apply({ ...context, tools: { register(tool) { tools.set(tool.name, tool) } } })
  return tools.get(name)
}

describe('query_order legacy compatibility', () => {
  it.each([
    ['ORDER-1001', [{ sku: 'SKU-1001', quantity: 1, unitPrice: 129 }]],
    ['order-1002', [{ sku: 'SKU-1002', quantity: 1, unitPrice: 399 }]],
    ['unknown-001', undefined],
  ])(
    'preserves canonical value and render for %s',
    async (orderId, expectedItems) => {
      const legacy = registeredTool(applyLegacy, {}, 'query_order')
      const current = registeredTool(
        applyNew,
        { customerState: new CustomerStateService(new Context()) },
        'query_order',
      )
      const legacyValue = await legacy.execute({ orderId })
      const currentValue = await current.execute({ orderId })
      const legacyRender = legacy.output.render({}, legacyValue)
      const currentRender = current.output.render({}, currentValue)

      if (!legacyValue.found) {
        expect(currentValue).toEqual(legacyValue)
        expect(currentRender).toEqual(legacyRender)
        return
      }

      const { items, ...legacyFields } = currentValue
      expect(legacyFields).toEqual(legacyValue)
      expect(items).toEqual(expectedItems)
      expect(currentRender[0].text.startsWith(legacyRender[0].text)).toBe(true)
      expect(currentRender[0].text).toContain(expectedItems[0].sku)
    },
  )
})
