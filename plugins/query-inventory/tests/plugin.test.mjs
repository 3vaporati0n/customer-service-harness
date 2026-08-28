import { describe, expect, it } from 'vitest'

import { apply, inject, name } from '../src/index.ts'

function loadTool(getInventory) {
  const tools = new Map()
  apply({
    customerState: { getInventory },
    tools: { register(tool) { tools.set(tool.name, tool) } },
  })
  return tools.get('query_inventory')
}

describe('query_inventory plugin', () => {
  it('registers one strict discriminated inventory query', () => {
    const tool = loadTool(() => undefined)
    expect(name).toBe('customer-query-inventory')
    expect(inject).toEqual(['tools', 'customerState'])
    expect(tool.parameters.required).toEqual(['sku'])
    const [found, notFound] = tool.output.schema.oneOf
    expect(found.additionalProperties).toBe(false)
    expect(found.properties.found).toEqual({ type: 'boolean', const: true })
    expect(notFound.additionalProperties).toBe(false)
    expect(notFound.properties.found).toEqual({ type: 'boolean', const: false })
  })

  it('returns and renders an in-stock product', async () => {
    const tool = loadTool(() => ({
      sku: 'SKU-1001', productName: '无线鼠标', stock: 12,
    }))
    const result = await tool.execute({ sku: ' sku-1001 ' })
    expect(result).toEqual({
      found: true,
      sku: 'SKU-1001',
      productName: '无线鼠标',
      stock: 12,
      inStock: true,
    })
    expect(tool.output.render({}, result)[0].text).toBe(
      '商品 SKU-1001（无线鼠标）当前库存 12 件，状态：有货。',
    )
  })

  it('returns and renders an out-of-stock product', async () => {
    const tool = loadTool(() => ({
      sku: 'SKU-1002', productName: '机械键盘', stock: 0,
    }))
    const result = await tool.execute({ sku: 'SKU-1002' })
    expect(result).toMatchObject({ found: true, stock: 0, inStock: false })
    expect(tool.output.render({}, result)[0].text).toBe(
      '商品 SKU-1002（机械键盘）当前库存 0 件，状态：缺货。',
    )
  })

  it('returns a normal unknown result', async () => {
    const tool = loadTool(() => undefined)
    const result = await tool.execute({ sku: 'unknown' })
    expect(result).toEqual({
      found: false,
      sku: 'UNKNOWN',
      message: '未找到商品 UNKNOWN，请检查 SKU。',
    })
    expect(tool.output.render({}, result)).toEqual([
      { type: 'text', text: '未找到商品 UNKNOWN，请检查 SKU。' },
    ])
  })

  it('validates missing and blank SKU independently', async () => {
    const tool = loadTool(() => undefined)
    await expect(tool.execute({})).rejects.toMatchObject({ name: 'ToolArgsError' })
    await expect(tool.execute({ sku: '   ' })).rejects.toThrow('SKU 不能为空。')
  })

  it('wraps unexpected state failures and preserves their cause', async () => {
    const tool = loadTool(() => { throw new Error('database failed') })
    await expect(tool.execute({ sku: 'SKU-1001' })).rejects.toMatchObject({
      message: '库存查询服务暂时不可用，请稍后重试。',
      cause: new Error('database failed'),
    })
  })
})
