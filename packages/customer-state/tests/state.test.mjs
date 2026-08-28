import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { MutableClock, createSeedState } from '@dsh-customer-service/domain'
import { SqliteCustomerStorage } from '@dsh-customer-service/storage-sqlite'
import { CustomerStateService, inject } from '../src/index.ts'
import { MemoryCustomerStorage } from '../src/memory-storage.ts'

function createState(options = {}) {
  let id = 0
  return new CustomerStateService(new Context(), {
    clock: new MutableClock('2026-08-27T12:00:00+08:00'),
    idFactory: () => `EVENT-${++id}`,
    ...options,
  })
}

describe('customerState service', () => {
  it('declares the storage injection required by the runtime plugin', () => {
    expect(inject).toEqual(['customerStorage'])
  })

  it('persists state updates after the SQLite storage is reopened', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'customer-state-sqlite-'))
    const databasePath = path.join(directory, 'customer-service.db')
    try {
      const firstStorage = new SqliteCustomerStorage(databasePath)
      const firstState = createState({ storage: firstStorage })
      await firstState.updateInventory('SKU-1002', () => ({ stock: 5 }))
      firstStorage.close()

      const secondStorage = new SqliteCustomerStorage(databasePath)
      const secondState = createState({ storage: secondStorage })
      expect(secondState.getInventory('SKU-1002')).toMatchObject({ stock: 5, version: 2 })
      secondStorage.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses the injected storage for reads and committed updates', async () => {
    const storage = new MemoryCustomerStorage(createSeedState())
    const state = createState({ storage })
    await state.updateInventory('SKU-1002', () => ({ stock: 7 }))

    expect(storage.getInventory('SKU-1002')).toMatchObject({ stock: 7, version: 2 })
    expect(state.getInventory('SKU-1002')).toMatchObject({ stock: 7, version: 2 })
  })

  it('returns detached snapshots for nested state', () => {
    const state = createState()
    const order = state.getOrder('order-1002')
    const logistics = state.getLogistics('order-1001')
    order.address = '外部篡改'
    logistics.events[0].description = '外部篡改'
    expect(state.getOrder('ORDER-1002').address).not.toBe('外部篡改')
    expect(state.getLogistics('ORDER-1001').events[0].description).toBe('包裹已发出')
  })

  it('serializes entity updates and returns a committed event', async () => {
    const state = createState()
    const first = state.updateInventory('sku-1002', (current) => ({
      stock: current.stock + 2,
    }))
    const second = state.updateInventory('SKU-1002', (current) => ({
      stock: current.stock + 3,
    }))

    const [firstChange, secondChange] = await Promise.all([first, second])
    expect(firstChange.before).toMatchObject({ stock: 0, version: 1 })
    expect(firstChange.after).toMatchObject({ stock: 2, version: 2 })
    expect(firstChange.event).toMatchObject({
      eventId: 'EVENT-1',
      type: 'inventory.changed',
      entityId: 'SKU-1002',
      version: 2,
    })
    expect(secondChange.before).toMatchObject({ stock: 2, version: 2 })
    expect(secondChange.after).toMatchObject({ stock: 5, version: 3 })
    expect(state.getInventory('SKU-1002')).toMatchObject({ stock: 5, version: 3 })
  })

  it('rejects invalid updates without changing state or allocating an event', async () => {
    const state = createState()
    await expect(
      state.updateInventory('SKU-1002', () => ({ stock: -1 })),
    ).rejects.toThrow('库存不能小于 0。')
    const change = await state.updateInventory('SKU-1002', () => ({ stock: 1 }))
    expect(change.before).toMatchObject({ stock: 0, version: 1 })
    expect(change.event.eventId).toBe('EVENT-1')
  })

  it('creates and finds detached return and refund records', async () => {
    const state = createState()
    const returned = await state.createReturn({
      returnId: 'return-1001',
      orderId: 'order-1003',
      reason: '不合适',
      status: 'approved',
    })
    const refunded = await state.createRefund({
      refundId: 'refund-1001',
      orderId: 'order-1003',
      returnId: 'return-1001',
      amount: 258,
      reason: '退货退款',
      status: 'pending',
    })

    expect(returned.before).toBeNull()
    expect(returned.after).toMatchObject({ returnId: 'RETURN-1001', version: 1 })
    expect(refunded.before).toBeNull()
    expect(refunded.after).toMatchObject({ refundId: 'REFUND-1001', version: 1 })
    const byOrder = state.findReturnByOrder('ORDER-1003')
    byOrder.reason = '外部篡改'
    expect(state.getReturn('RETURN-1001').reason).toBe('不合适')
    expect(state.findRefundByOrder('order-1003').refundId).toBe('REFUND-1001')
    await expect(state.createReturn({
      returnId: returned.after.returnId,
      orderId: returned.after.orderId,
      reason: returned.after.reason,
      status: returned.after.status,
    }))
      .rejects.toThrow('业务实体 RETURN-1001 已存在。')
  })

  it('allows a new application after a rejected return or failed refund', async () => {
    const state = createState()
    await state.createReturn({
      returnId: 'RETURN-A', orderId: 'ORDER-1003', reason: '第一次', status: 'rejected',
    })
    await state.createReturn({
      returnId: 'RETURN-B', orderId: 'ORDER-1003', reason: '第二次', status: 'approved',
    })
    await state.createRefund({
      refundId: 'REFUND-A', orderId: 'ORDER-1003', returnId: 'RETURN-A',
      amount: 258, reason: '第一次', status: 'failed',
    })
    await state.createRefund({
      refundId: 'REFUND-B', orderId: 'ORDER-1003', returnId: 'RETURN-B',
      amount: 258, reason: '第二次', status: 'pending',
    })

    expect(state.listReturnsByOrder('order-1003').map((item) => item.returnId))
      .toEqual(['RETURN-B', 'RETURN-A'])
    expect(state.listRefundsByOrder('order-1003').map((item) => item.refundId))
      .toEqual(['REFUND-B', 'REFUND-A'])
  })

  it('creates a normalized five-record chain with generated fields', async () => {
    const state = createState({
      clock: new MutableClock('2026-08-28T10:00:00+08:00'),
    })
    const inventory = await state.createInventory({
      sku: ' sku-test-001 ', productName: ' 测试鼠标 ', stock: 20,
    })
    const order = await state.createOrder({
      orderId: ' order-test-001 ',
      customerId: ' customer-test-001 ',
      status: 'processing',
      address: ' 苏州市工业园区 ',
      estimatedDelivery: '2026-09-01',
      items: [{ sku: ' sku-test-001 ', quantity: 2, unitPrice: 99 }],
    })
    const logistics = await state.createLogistics({
      orderId: ' order-test-001 ',
      status: 'pending_shipment',
      location: ' 苏州仓库 ',
      description: ' 测试物流已创建 ',
    })
    const returned = await state.createReturn({
      returnId: ' return-test-001 ',
      orderId: ' order-test-001 ',
      reason: ' 不合适 ',
      status: 'approved',
    })
    const refunded = await state.createRefund({
      refundId: ' refund-test-001 ',
      orderId: ' order-test-001 ',
      returnId: ' return-test-001 ',
      amount: 198,
      reason: ' 退货退款 ',
      status: 'pending',
    })

    expect(inventory.after).toMatchObject({
      sku: 'SKU-TEST-001', productName: '测试鼠标', version: 1,
      updatedAt: '2026-08-28T02:00:00.000Z',
    })
    expect(order.after).toMatchObject({
      orderId: 'ORDER-TEST-001', customerId: 'CUSTOMER-TEST-001',
      totalAmount: 198, createdAt: '2026-08-28T02:00:00.000Z', version: 1,
    })
    expect(logistics.after.events).toEqual([{
      time: '2026-08-28T02:00:00.000Z',
      location: '苏州仓库',
      description: '测试物流已创建',
    }])
    expect(returned.after).toMatchObject({ returnId: 'RETURN-TEST-001', version: 1 })
    expect(refunded.after).toMatchObject({ refundId: 'REFUND-TEST-001', version: 1 })
    expect([
      inventory.event.type,
      order.event.type,
      logistics.event.type,
      returned.event.type,
      refunded.event.type,
    ]).toEqual([
      'inventory.changed',
      'order.updated',
      'logistics.updated',
      'return.updated',
      'refund.updated',
    ])
  })

  it('sets deliveredAt when a delivered order is created', async () => {
    const state = createState({
      clock: new MutableClock('2026-08-28T10:00:00+08:00'),
    })
    await state.createInventory({ sku: 'SKU-X', productName: '鼠标', stock: 1 })
    const change = await state.createOrder({
      orderId: 'ORDER-X', customerId: 'CUSTOMER-X', status: 'delivered',
      address: '苏州', estimatedDelivery: '2026-09-01',
      items: [{ sku: 'SKU-X', quantity: 1, unitPrice: 1 }],
    })
    expect(change.after.deliveredAt).toBe('2026-08-28T02:00:00.000Z')
  })

  it('rejects invalid values and missing relationships without allocating events', async () => {
    const state = createState()
    await expect(state.createInventory({ sku: ' ', productName: '鼠标', stock: 1 }))
      .rejects.toThrow('业务编号不能为空。')
    await expect(state.createInventory({ sku: 'SKU-X', productName: ' ', stock: 1 }))
      .rejects.toThrow('商品名称不能为空。')
    await expect(state.createInventory({ sku: 'SKU-X', productName: '鼠标', stock: -1 }))
      .rejects.toThrow('库存不能小于 0。')
    await expect(state.createOrder({
      orderId: 'ORDER-X', customerId: 'CUSTOMER-X', status: 'processing',
      address: '苏州', estimatedDelivery: '2026-02-30', items: [],
    })).rejects.toThrow('预计送达日期必须是有效的 YYYY-MM-DD 日期。')
    await expect(state.createOrder({
      orderId: 'ORDER-X', customerId: 'CUSTOMER-X', status: 'processing',
      address: '苏州', estimatedDelivery: '2026-09-01', items: [],
    })).rejects.toThrow('订单至少包含一件商品。')
    await expect(state.createOrder({
      orderId: 'ORDER-X', customerId: 'CUSTOMER-X', status: 'processing',
      address: '苏州', estimatedDelivery: '2026-09-01',
      items: [{ sku: 'SKU-MISSING', quantity: 1, unitPrice: 1 }],
    })).rejects.toThrow('商品 SKU-MISSING 不存在，无法加入订单。')
    await expect(state.createOrder({
      orderId: 'ORDER-X', customerId: 'CUSTOMER-X', status: 'processing',
      address: '苏州', estimatedDelivery: '2026-09-01',
      items: [{ sku: 'SKU-1001', quantity: 0, unitPrice: 1 }],
    })).rejects.toThrow('订单商品数量必须为正整数。')
    await expect(state.createOrder({
      orderId: 'ORDER-X', customerId: 'CUSTOMER-X', status: 'processing',
      address: '苏州', estimatedDelivery: '2026-09-01',
      items: [{ sku: 'SKU-1001', quantity: 1, unitPrice: Number.POSITIVE_INFINITY }],
    })).rejects.toThrow('订单商品单价不能小于 0。')
    await expect(state.createLogistics({
      orderId: 'ORDER-X', status: 'pending_shipment',
      location: '苏州', description: '创建',
    })).rejects.toThrow('订单 ORDER-X 不存在，无法创建物流记录。')
    await expect(state.createReturn({
      returnId: 'RETURN-X', orderId: 'ORDER-X', reason: '不合适', status: 'approved',
    })).rejects.toThrow('订单 ORDER-X 不存在，无法创建退货记录。')
    await expect(state.createRefund({
      refundId: 'REFUND-X', orderId: 'ORDER-X', amount: 1,
      reason: '退款', status: 'pending',
    })).rejects.toThrow('订单 ORDER-X 不存在，无法创建退款记录。')
    expect(state.getInventory('SKU-X')).toBeUndefined()
    expect(state.getOrder('ORDER-X')).toBeUndefined()
    const change = await state.createInventory({ sku: 'SKU-X', productName: '鼠标', stock: 1 })
    expect(change.event.eventId).toBe('EVENT-1')
  })

  it('rejects duplicate identities and mismatched return relationships', async () => {
    const state = createState()
    await expect(state.createLogistics({
      orderId: 'ORDER-1001', status: 'pending_shipment',
      location: '苏州', description: '重复物流',
    })).rejects.toThrow('业务实体 ORDER-1001 已存在。')

    await state.createReturn({
      returnId: 'RETURN-X', orderId: 'ORDER-1003', reason: '不合适', status: 'approved',
    })
    await expect(state.createReturn({
      returnId: 'RETURN-X', orderId: 'ORDER-1003', reason: '仍不合适', status: 'approved',
    })).rejects.toThrow('业务实体 RETURN-X 已存在。')

    await expect(state.createRefund({
      refundId: 'REFUND-MISSING', orderId: 'ORDER-1002', returnId: 'RETURN-NOPE',
      amount: 1, reason: '退款', status: 'pending',
    })).rejects.toThrow('退货记录 RETURN-NOPE 不存在。')
    await expect(state.createRefund({
      refundId: 'REFUND-MISMATCH', orderId: 'ORDER-1002', returnId: 'RETURN-X',
      amount: 1, reason: '退款', status: 'pending',
    })).rejects.toThrow('退货记录 RETURN-X 不属于订单 ORDER-1002。')

    await state.createRefund({
      refundId: 'REFUND-X', orderId: 'ORDER-1003', returnId: 'RETURN-X',
      amount: 1, reason: '退款', status: 'pending',
    })
    await expect(state.createRefund({
      refundId: 'REFUND-X', orderId: 'ORDER-1003', amount: 1,
      reason: '退款', status: 'pending',
    })).rejects.toThrow('业务实体 REFUND-X 已存在。')
  })

  it('advances the injected clock and emits a versioned clock event', async () => {
    const state = createState()
    const change = await state.advanceClock(25)
    expect(change).toMatchObject({
      before: '2026-08-27T04:00:00.000Z',
      after: '2026-08-28T05:00:00.000Z',
    })
    expect(change.event).toMatchObject({
      eventId: 'EVENT-1',
      type: 'clock.advanced',
      entityId: 'CLOCK',
      version: 1,
      payload: { hours: 25 },
    })
  })
})
