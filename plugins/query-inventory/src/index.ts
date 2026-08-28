import type { Context } from '@deepseek-ai/cordis'
import { defineCustomerTool } from '@dsh-customer-service/domain'
import '@dsh-customer-service/state'

const INVENTORY_RESULT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', const: true, required: true },
        sku: { type: 'string', required: true },
        productName: { type: 'string', required: true },
        stock: { type: 'integer', required: true },
        inStock: { type: 'boolean', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', const: false, required: true },
        sku: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
  ],
} as const

export class InvalidSkuError extends Error {
  constructor() {
    super('SKU 不能为空。')
    this.name = 'InvalidSkuError'
  }
}

export const name = 'customer-query-inventory'
export const inject = ['tools', 'customerState'] as const

export function apply(ctx: Context) {
  ctx.tools.register(
    defineCustomerTool({
      name: 'query_inventory',
      description: '根据 SKU 查询商品名称、库存数量和是否有货。',
      parameters: {
        sku: {
          type: 'string',
          required: true,
          description: '需要查询的商品 SKU，例如 SKU-1001。',
        },
      },
      output: {
        schema: INVENTORY_RESULT_SCHEMA,
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: value.message }]
          return [{
            type: 'text',
            text: `商品 ${value.sku}（${value.productName}）当前库存 ${value.stock} 件，状态：${value.inStock ? '有货' : '缺货'}。`,
          }]
        },
      },
      async execute(args) {
        if (!args.sku.trim()) throw new InvalidSkuError()
        const sku = args.sku.trim().toUpperCase()
        try {
          const inventory = ctx.customerState.getInventory(sku)
          if (!inventory) {
            return {
              found: false,
              sku,
              message: `未找到商品 ${sku}，请检查 SKU。`,
            } as const
          }
          return {
            found: true,
            sku: inventory.sku,
            productName: inventory.productName,
            stock: inventory.stock,
            inStock: inventory.stock > 0,
          } as const
        } catch (error) {
          throw new Error('库存查询服务暂时不可用，请稍后重试。', { cause: error })
        }
      },
    }),
  )
}
