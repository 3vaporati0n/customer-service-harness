import type {
  Inventory,
  Logistics,
  Order,
  SeedState,
} from './index.js'

const ORDERS: readonly Order[] = [
  {
    orderId: 'ORDER-1001',
    customerId: 'CUSTOMER-001',
    status: 'shipped',
    address: '江苏省苏州市工业园区星湖街 1 号',
    estimatedDelivery: '2026-08-28',
    items: [{ sku: 'SKU-1001', quantity: 1, unitPrice: 129 }],
    totalAmount: 129,
    createdAt: '2026-08-26T08:30:00+08:00',
    updatedAt: '2026-08-26T09:20:00+08:00',
    version: 1,
  },
  {
    orderId: 'ORDER-1002',
    customerId: 'CUSTOMER-002',
    status: 'processing',
    address: '上海市浦东新区世纪大道 100 号',
    estimatedDelivery: '2026-08-30',
    items: [{ sku: 'SKU-1002', quantity: 1, unitPrice: 399 }],
    totalAmount: 399,
    createdAt: '2026-08-25T08:00:00+08:00',
    updatedAt: '2026-08-27T08:00:00+08:00',
    version: 1,
  },
  {
    orderId: 'ORDER-1003',
    customerId: 'CUSTOMER-003',
    status: 'delivered',
    address: '浙江省杭州市西湖区文三路 18 号',
    estimatedDelivery: '2026-08-26',
    items: [{ sku: 'SKU-1001', quantity: 2, unitPrice: 129 }],
    totalAmount: 258,
    createdAt: '2026-08-23T09:00:00+08:00',
    deliveredAt: '2026-08-26T10:00:00+08:00',
    updatedAt: '2026-08-26T10:00:00+08:00',
    version: 1,
  },
]

const INVENTORIES: readonly Inventory[] = [
  {
    sku: 'SKU-1001',
    productName: '无线鼠标',
    stock: 12,
    updatedAt: '2026-08-27T12:00:00+08:00',
    version: 1,
  },
  {
    sku: 'SKU-1002',
    productName: '机械键盘',
    stock: 0,
    updatedAt: '2026-08-27T12:00:00+08:00',
    version: 1,
  },
]

const LOGISTICS: readonly Logistics[] = [
  {
    orderId: 'ORDER-1001',
    status: 'in_transit',
    currentStatus: '运输中',
    events: [
      {
        time: '2026-08-26 09:20',
        location: '上海分拨中心',
        description: '包裹已发出',
      },
      {
        time: '2026-08-26 18:40',
        location: '苏州转运中心',
        description: '包裹运输中',
      },
    ],
    updatedAt: '2026-08-26T18:40:00+08:00',
    version: 1,
  },
  {
    orderId: 'ORDER-1002',
    status: 'pending_shipment',
    currentStatus: '待发货',
    events: [
      {
        time: '2026-08-27 08:00',
        location: '商家仓库',
        description: '订单已创建，等待发货',
      },
    ],
    updatedAt: '2026-08-27T08:00:00+08:00',
    version: 1,
  },
  {
    orderId: 'ORDER-1003',
    status: 'delivered',
    currentStatus: '已签收',
    events: [
      {
        time: '2026-08-26 10:00',
        location: '杭州西湖营业点',
        description: '包裹已签收',
      },
    ],
    updatedAt: '2026-08-26T10:00:00+08:00',
    version: 1,
  },
]

function cloneMap<T extends object>(items: readonly T[], key: keyof T): Map<string, T> {
  return new Map(items.map((item) => [String(item[key]), structuredClone(item)]))
}

export function createSeedState(): SeedState {
  return {
    orders: cloneMap(ORDERS, 'orderId'),
    inventories: cloneMap(INVENTORIES, 'sku'),
    logistics: cloneMap(LOGISTICS, 'orderId'),
    returns: new Map(),
    refunds: new Map(),
  }
}
