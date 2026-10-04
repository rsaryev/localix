import { describe, it, expect } from 'bun:test'
import { isInteractAllowedForOwner } from './interact-ownership'

describe('isInteractAllowedForOwner — process-control interact ownership gate', () => {
  it('allows when caller owns the job', () => {
    expect(isInteractAllowedForOwner('userA', 'userA')).toBe(true)
  })

  it('BLOCKS a different user from acting on another user’s job (cross-tenant)', () => {
    expect(isInteractAllowedForOwner('userA', 'userB')).toBe(false)
  })

  it('allows trusted internal callers (no callerUserId — jobs tool / shutdown)', () => {
    expect(isInteractAllowedForOwner('userA', undefined)).toBe(true)
  })

  it('allows when the toolCallId has no recorded owner (not an owned bg job)', () => {
    expect(isInteractAllowedForOwner(undefined, 'userB')).toBe(true)
  })

  it('allows when both owner and caller are absent', () => {
    expect(isInteractAllowedForOwner(undefined, undefined)).toBe(true)
  })

  it('default single-user (local-user) is unaffected — owner equals caller', () => {
    expect(isInteractAllowedForOwner('local-user', 'local-user')).toBe(true)
  })
})
