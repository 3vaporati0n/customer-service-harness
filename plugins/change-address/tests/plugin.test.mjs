import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { CustomerApprovalService } from '@dsh-customer-service/approval'
import { MutableClock } from '@dsh-customer-service/domain'
import { CustomerEventsService } from '@dsh-customer-service/events'
import { CustomerStateService } from '@dsh-customer-service/state'
import { apply, inject, name } from '../src/index.ts'

function createFixture() {
  const base = new Context()
  const clock = new MutableClock('2026-08-27T12:00:00+08:00')
  let eventId = 0
  let id = 0
  const state = new CustomerStateService(base, {
    clock, idFactory: () => `EVENT-${++eventId}`,
  })
  const approval = new CustomerApprovalService(base, {
    clock,
    idFactory: () => `${id++ % 2 === 0 ? 'CONFIRM' : 'AUDIT'}-${Math.ceil(id / 2)}`,
  })
  const published = []
  const events = { async publish(event) { published.push(event); return [] } }
  const tools = new Map()
  apply({
    customerState: state, customerApproval: approval, customerEvents: events,
    tools: { register(tool) { tools.set(tool.name, tool) } },
  })
  return { approval, events, published, state, tools }
}

describe('change address plugin', () => {
  it('registers two strict tools with shared service dependencies', () => {
    const { tools } = createFixture()
    expect(name).toBe('customer-change-address')
    expect(inject).toEqual(['tools', 'customerState', 'customerApproval', 'customerEvents'])
    expect([...tools.keys()]).toEqual(['request_address_change', 'confirm_address_change'])
    expect(tools.get('request_address_change').parameters).toMatchObject({
      additionalProperties: false, required: ['orderId', 'newAddress'],
    })
  })

  it('rejects unknown, shipped, and blank-address requests', async () => {
    const { tools } = createFixture()
    await expect(tools.get('request_address_change').execute({
      orderId: 'missing', newAddress: '苏州市测试路 8 号',
    })).resolves.toMatchObject({ accepted: false, code: 'ORDER_NOT_FOUND' })
    await expect(tools.get('request_address_change').execute({
      orderId: 'ORDER-1001', newAddress: '苏州市测试路 8 号',
    })).resolves.toMatchObject({ accepted: false, code: 'ORDER_ALREADY_SHIPPED' })
    await expect(tools.get('request_address_change').execute({
      orderId: 'ORDER-1002', newAddress: '   ',
    })).rejects.toThrow('新收货地址不能为空。')
  })

  it('binds the normalized address and revalidates before confirmation', async () => {
    const { approval, state, tools } = createFixture()
    const request = await tools.get('request_address_change').execute({
      orderId: ' order-1002 ', newAddress: ' 江苏省苏州市测试路 8 号 ',
    })
    expect(request).toMatchObject({
      accepted: true, action: 'change_address', orderId: 'ORDER-1002',
      confirmationId: 'CONFIRM-1', newAddress: '江苏省苏州市测试路 8 号',
    })
    expect(tools.get('request_address_change').output.render({}, request)[0].text)
      .toContain('CONFIRM-1')
    expect(approval.validate('CONFIRM-1', 'change_address')).toMatchObject({
      valid: true, payload: { newAddress: '江苏省苏州市测试路 8 号' },
    })
    await state.updateOrder('ORDER-1002', () => ({ status: 'shipped' }))
    await expect(tools.get('confirm_address_change').execute({
      confirmationId: 'CONFIRM-1',
    })).resolves.toMatchObject({ applied: false, code: 'ORDER_ALREADY_SHIPPED' })
  })

  it('updates once, publishes, audits, and replays without a second version increment', async () => {
    const { approval, published, state, tools } = createFixture()
    const request = await tools.get('request_address_change').execute({
      orderId: 'ORDER-1002', newAddress: '江苏省苏州市测试路 8 号',
    })
    const [first, second] = await Promise.all([
      tools.get('confirm_address_change').execute({ confirmationId: request.confirmationId }),
      tools.get('confirm_address_change').execute({ confirmationId: request.confirmationId }),
    ])
    expect(first).toMatchObject({
      applied: true, action: 'change_address', orderId: 'ORDER-1002',
      newAddress: '江苏省苏州市测试路 8 号', auditId: 'AUDIT-1', alreadyApplied: false,
    })
    expect(second).toEqual({ ...first, alreadyApplied: true })
    expect(state.getOrder('ORDER-1002')).toMatchObject({
      address: '江苏省苏州市测试路 8 号', version: 2,
    })
    expect(published).toHaveLength(1)
    expect(approval.getAudit('AUDIT-1')).toMatchObject({ action: 'change_address' })
  })

  it('wraps internal failures without exposing their details', async () => {
    const { state, tools } = createFixture()
    state.getOrder = () => { throw new Error('/private/customer.db is locked') }
    const promise = tools.get('request_address_change').execute({
      orderId: 'ORDER-1002', newAddress: '测试地址',
    })
    await expect(promise).rejects.toMatchObject({
      message: '修改地址服务暂时不可用，请稍后重试。',
      cause: { message: '/private/customer.db is locked' },
    })
  })

  it('returns committed success when event publication fails', async () => {
    const { events, state, tools } = createFixture()
    const request = await tools.get('request_address_change').execute({
      orderId: 'ORDER-1002', newAddress: '测试地址',
    })
    events.publish = async () => { throw new Error('delivery adapter failed') }

    await expect(tools.get('confirm_address_change').execute({
      confirmationId: request.confirmationId,
    })).resolves.toMatchObject({ applied: true, alreadyApplied: false })
    await expect(tools.get('confirm_address_change').execute({
      confirmationId: request.confirmationId,
    })).resolves.toMatchObject({ applied: true, alreadyApplied: true })
    expect(state.getOrder('ORDER-1002')).toMatchObject({ address: '测试地址', version: 2 })
  })
})
