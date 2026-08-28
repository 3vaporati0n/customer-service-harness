import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { MutableClock } from '@dsh-customer-service/domain'
import {
  CustomerApprovalService,
  decideHarnessApproval,
  requiresHarnessApproval,
} from '../src/index.ts'

function createApproval() {
  const clock = new MutableClock('2026-08-27T12:00:00+08:00')
  let id = 0
  const approval = new CustomerApprovalService(new Context(), {
    clock,
    idFactory: () => `ID-${++id}`,
  })
  return { approval, clock }
}

describe('customerApproval service', () => {
  it('issues a normalized immutable ten-minute confirmation', () => {
    const { approval } = createApproval()
    const payload = { reason: '不需要了' }
    const confirmation = approval.issue({
      action: 'cancel_order',
      targetId: ' order-1002 ',
      payload,
    })
    payload.reason = '外部篡改'

    expect(confirmation).toMatchObject({
      confirmationId: 'ID-1',
      action: 'cancel_order',
      targetId: 'ORDER-1002',
      payload: { reason: '不需要了' },
      createdAt: '2026-08-27T04:00:00.000Z',
      expiresAt: '2026-08-27T04:10:00.000Z',
    })
    expect(approval.validate('id-1', 'cancel_order')).toEqual({
      valid: true,
      targetId: 'ORDER-1002',
      payload: { reason: '不需要了' },
    })
  })

  it('returns deterministic validation failures', () => {
    const { approval, clock } = createApproval()
    const confirmation = approval.issue({
      action: 'cancel_order',
      targetId: 'ORDER-1002',
      payload: { reason: '不需要了' },
    })
    expect(approval.validate('missing', 'cancel_order')).toEqual({
      valid: false,
      code: 'CONFIRMATION_NOT_FOUND',
    })
    expect(approval.validate(confirmation.confirmationId, 'refund_order')).toEqual({
      valid: false,
      code: 'CONFIRMATION_ACTION_MISMATCH',
    })
    clock.advanceHours(1)
    expect(approval.validate(confirmation.confirmationId, 'cancel_order')).toEqual({
      valid: false,
      code: 'CONFIRMATION_EXPIRED',
    })
  })

  it('records one immutable audit result and returns it idempotently', () => {
    const { approval } = createApproval()
    const confirmation = approval.issue({
      action: 'cancel_order',
      targetId: 'ORDER-1002',
      payload: { reason: '不需要了' },
    })
    const applied = approval.recordApplied(confirmation.confirmationId, {
      before: { status: 'processing' },
      after: { status: 'cancelled' },
    })
    const repeated = approval.recordApplied(confirmation.confirmationId, {
      before: { status: 'tampered' },
      after: { status: 'tampered' },
    })
    expect(applied).toMatchObject({
      auditId: 'ID-2',
      confirmationId: 'ID-1',
      before: { status: 'processing' },
      after: { status: 'cancelled' },
      alreadyApplied: false,
    })
    expect(repeated).toEqual({ ...applied, alreadyApplied: true })
    const audit = approval.getAudit(applied.auditId)
    audit.after.status = '外部篡改'
    expect(approval.getAudit(applied.auditId).after).toEqual({ status: 'cancelled' })
  })

  it('returns an applied confirmation only for the matching action', () => {
    const { approval } = createApproval()
    const confirmation = approval.issue({
      action: 'cancel_order',
      targetId: 'ORDER-1002',
      payload: { reason: '不需要了' },
    })

    expect(approval.getApplied(confirmation.confirmationId, 'cancel_order')).toBeUndefined()
    const applied = approval.recordApplied(confirmation.confirmationId, {
      before: { status: 'processing' },
      after: { status: 'cancelled' },
    })
    const replay = approval.getApplied(' id-1 ', 'cancel_order')
    replay.after.status = '外部篡改'

    expect(replay).toEqual({ ...applied, after: { status: '外部篡改' } })
    expect(approval.getApplied('ID-1', 'cancel_order')).toEqual(applied)
    expect(approval.getApplied('ID-1', 'refund_order')).toBeUndefined()
    expect(approval.getApplied('MISSING', 'cancel_order')).toBeUndefined()
  })

  it('serializes work for the same confirmation while allowing replay lookup', async () => {
    const { approval } = createApproval()
    const confirmation = approval.issue({
      action: 'cancel_order', targetId: 'ORDER-1002', payload: { reason: '不需要了' },
    })
    const order = []
    const first = approval.withConfirmation(confirmation.confirmationId, async () => {
      order.push('first:start')
      await Promise.resolve()
      order.push('first:end')
      return 'first'
    })
    const second = approval.withConfirmation(confirmation.confirmationId, async () => {
      order.push('second:start')
      order.push('second:end')
      return 'second'
    })

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('asks only for the exact after-sales confirmation tools', async () => {
    expect(requiresHarnessApproval('confirm_refund')).toBe(true)
    expect(requiresHarnessApproval('query_order')).toBe(false)
    expect(requiresHarnessApproval('confirm_unrelated_plugin')).toBe(false)
    expect(await decideHarnessApproval('confirm_refund', async () => ({ kind: 'allow' })))
      .toEqual({ kind: 'ask', reason: '该操作将修改客服业务数据。' })
    expect(await decideHarnessApproval('query_order', async () => ({ kind: 'allow' })))
      .toEqual({ kind: 'allow' })
  })
})
