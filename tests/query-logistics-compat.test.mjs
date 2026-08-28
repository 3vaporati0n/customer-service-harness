import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { CustomerStateService } from '@dsh-customer-service/state'
import { apply as applyNew } from '../plugins/query-logistics/src/index.ts'
import { apply as applyLegacy } from '../legacy/dsh-plugin-order-query/src/index.ts'

function registeredTool(apply, context, name) {
  const tools = new Map()
  apply({ ...context, tools: { register(tool) { tools.set(tool.name, tool) } } })
  return tools.get(name)
}

describe('query_logistics legacy compatibility', () => {
  it.each(['ORDER-1001', 'order-1002', 'unknown-001'])(
    'preserves canonical value and render for %s',
    async (orderId) => {
      const legacy = registeredTool(applyLegacy, {}, 'query_logistics')
      const current = registeredTool(
        applyNew,
        { customerState: new CustomerStateService(new Context()) },
        'query_logistics',
      )
      const legacyValue = await legacy.execute({ orderId })
      const currentValue = await current.execute({ orderId })
      expect(currentValue).toEqual(legacyValue)
      expect(current.output.render({}, currentValue)).toEqual(
        legacy.output.render({}, legacyValue),
      )
    },
  )
})
