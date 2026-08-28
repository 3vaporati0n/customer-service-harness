import { describe, expect, it } from 'vitest'
import { createSeedState } from '@dsh-customer-service/domain'
import { MemoryCustomerStorage } from '../src/memory-storage.ts'

function inventory() {
  return {
    sku: 'SKU-TEST-001',
    productName: '测试鼠标',
    stock: 20,
    updatedAt: '2026-08-28T02:00:00.000Z',
    version: 1,
  }
}

function order() {
  return {
    orderId: 'ORDER-TEST-001',
    customerId: 'CUSTOMER-TEST-001',
    status: 'processing',
    address: '苏州市工业园区',
    estimatedDelivery: '2026-09-01',
    items: [{ sku: 'SKU-TEST-001', quantity: 2, unitPrice: 99 }],
    totalAmount: 198,
    createdAt: '2026-08-28T02:00:00.000Z',
    updatedAt: '2026-08-28T02:00:00.000Z',
    version: 1,
  }
}

function logistics() {
  return {
    orderId: 'ORDER-TEST-001',
    status: 'pending_shipment',
    currentStatus: '待发货',
    events: [{
      time: '2026-08-28T02:00:00.000Z',
      location: '苏州仓库',
      description: '测试物流已创建',
    }],
    updatedAt: '2026-08-28T02:00:00.000Z',
    version: 1,
  }
}

describe('MemoryCustomerStorage strict inserts', () => {
  it('inserts detached inventory, order, and logistics records', () => {
    const storage = new MemoryCustomerStorage(createSeedState())
    const inputInventory = inventory()
    const inputOrder = order()
    storage.insertInventory(inputInventory)
    storage.insertOrder(inputOrder)
    storage.insertLogistics(logistics())
    inputInventory.productName = '外部篡改'
    inputOrder.items[0].quantity = 99
    expect(storage.getInventory('sku-test-001')).toMatchObject({
      productName: '测试鼠标', version: 1,
    })
    expect(storage.getOrder('order-test-001').items[0].quantity).toBe(2)
    expect(storage.getLogistics('order-test-001')).toMatchObject({ version: 1 })
  })

  it('rejects duplicate identities', () => {
    const storage = new MemoryCustomerStorage(createSeedState())
    storage.insertInventory(inventory())
    expect(() => storage.insertInventory(inventory()))
      .toThrow('业务实体 SKU-TEST-001 已存在。')
  })

  it('rolls all inserts back when a transaction fails', () => {
    const storage = new MemoryCustomerStorage(createSeedState())
    expect(() => storage.transaction(() => {
      storage.insertInventory(inventory())
      storage.insertOrder(order())
      throw new Error('rollback')
    })).toThrow('rollback')
    expect(storage.getInventory('SKU-TEST-001')).toBeUndefined()
    expect(storage.getOrder('ORDER-TEST-001')).toBeUndefined()
  })

  it('lists multiple after-sales records newest-first without exposing stored values', () => {
    const storage = new MemoryCustomerStorage(createSeedState())
    storage.insertReturn({
      returnId: 'RETURN-A', orderId: 'ORDER-1003', reason: '第一次',
      status: 'rejected', createdAt: '2026-08-27T01:00:00.000Z', version: 1,
    })
    storage.insertReturn({
      returnId: 'RETURN-B', orderId: 'ORDER-1003', reason: '第二次',
      status: 'approved', createdAt: '2026-08-27T02:00:00.000Z', version: 1,
    })
    storage.insertRefund({
      refundId: 'REFUND-A', orderId: 'ORDER-1003', amount: 258,
      reason: '第一次', status: 'failed', updatedAt: '2026-08-27T03:00:00.000Z', version: 1,
    })
    storage.insertRefund({
      refundId: 'REFUND-B', orderId: 'ORDER-1003', amount: 258,
      reason: '第二次', status: 'pending', updatedAt: '2026-08-27T04:00:00.000Z', version: 1,
    })

    const returns = storage.listReturnsByOrder('order-1003')
    const refunds = storage.listRefundsByOrder('order-1003')
    returns[0].reason = '外部篡改'
    refunds[0].reason = '外部篡改'
    expect(returns.map((item) => item.returnId)).toEqual(['RETURN-B', 'RETURN-A'])
    expect(refunds.map((item) => item.refundId)).toEqual(['REFUND-B', 'REFUND-A'])
    expect(storage.findReturnByOrder('ORDER-1003').reason).toBe('第二次')
    expect(storage.findRefundByOrder('ORDER-1003').reason).toBe('第二次')
  })
})
