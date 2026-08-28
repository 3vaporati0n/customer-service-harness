import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import '@dsh-customer-service/events'
import '@dsh-customer-service/state'
import { createTestDataTools } from './tools.js'

export const TEST_DATA_TOOL_NAMES = new Set([
  'test_create_inventory',
  'test_create_order',
  'test_create_logistics',
  'test_create_return',
  'test_create_refund',
])

export async function decideTestDataApproval(
  name: string,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  if (!TEST_DATA_TOOL_NAMES.has(name)) return next()
  return {
    kind: 'ask',
    reason: '该操作将向本地 SQLite 验收数据库新增客服测试数据。',
  }
}

export const name = 'customer-test-data-entry'
export const inject = ['tools', 'customerState', 'customerEvents'] as const

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', (execution, next) =>
    decideTestDataApproval(execution.name, next),
  )
  for (const tool of createTestDataTools(ctx)) ctx.tools.register(tool)
}
