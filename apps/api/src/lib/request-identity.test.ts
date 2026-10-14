import { describe, expect, test } from 'bun:test'

import { requestQueryKeys, resolveRequestUserId } from './request-identity'
import { isInteractAllowedForOwner } from '../features/chat/runtime/interact-ownership'

const DEFAULT = 'local-user'

describe('resolveRequestUserId — the self-asserted identity boundary', () => {
  test('an absent header falls back to the default user', () => {
    expect(resolveRequestUserId(undefined, DEFAULT)).toBe(DEFAULT)
  })

  test('a real id is used verbatim (trimmed)', () => {
    expect(resolveRequestUserId('alice', DEFAULT)).toBe('alice')
    expect(resolveRequestUserId('  alice  ', DEFAULT)).toBe('alice')
  })

  // ── THE FIX: a DEGENERATE header must never become `''`. `??` alone let it through. ──
  test('a blank/whitespace header is treated as absent → default, never the empty string', () => {
    for (const raw of ['', ' ', '   ', '\t', '\n', '\t \n']) {
      const resolved = resolveRequestUserId(raw, DEFAULT)
      expect(resolved).toBe(DEFAULT)
      expect(resolved).not.toBe('') // the vector: '' is falsy and impersonates the internal caller
    }
  })
})

/**
 * The fail-open this closes, asserted end-to-end against the real ownership rule.
 *
 * A background job / HITL request / preview command records its OWNER; an `interact`
 * from a DIFFERENT user must be refused (`interact-ownership.ts`). The trusted-internal
 * path (`undefined` caller — jobs tool / shutdown) is intentionally allowed. The bug: a
 * blank `x-user-id` header yielded `''`, which `if (!callerUserId)` treats as that
 * trusted-internal caller → ownership bypassed on EVERY owned action.
 *
 * With the boundary sanitizer, a blank header resolves to a CONCRETE user id, so it is
 * subject to the same ownership check as anyone else. Mutation-check: revert
 * `resolveRequestUserId` to `rawHeader ?? defaultUserId` and the blank case below goes
 * `''` → `isInteractAllowedForOwner('userA', '')` returns true → this test goes RED.
 */
describe('a blank request identity cannot bypass owner checks', () => {
  test('blank header identity is BLOCKED on a foreign-owned action', () => {
    const identity = resolveRequestUserId('', DEFAULT)
    expect(isInteractAllowedForOwner('userA', identity)).toBe(false)
  })

  test('the legitimate internal caller (undefined) is still trusted', () => {
    expect(isInteractAllowedForOwner('userA', undefined)).toBe(true)
  })

  test('a caller that genuinely owns the action is still allowed', () => {
    const identity = resolveRequestUserId('', DEFAULT) // → DEFAULT
    expect(isInteractAllowedForOwner(DEFAULT, identity)).toBe(true)
  })

  /**
   * The class, not just the one guard. `interact` centralizes on `isInteractAllowedForOwner`,
   * but a PARALLEL guard `chatService.stop(sessionId, callerUserId?)` gates ownership with its
   * own `if (callerUserId)` and would also skip the check on a falsy `''`. Both are closed by the
   * SAME entry guarantee: a resolved request identity is always TRUTHY, so every downstream
   * `if (callerUserId)` engages its ownership branch instead of the trusted-internal one. That
   * guarantee is what this asserts — the reason the fix lives at the entry, not in each guard.
   */
  test('a resolved request identity is always truthy (covers every `if (callerUserId)` guard, incl. chatService.stop)', () => {
    for (const raw of ['', '   ', '\t', undefined, 'alice']) {
      expect(Boolean(resolveRequestUserId(raw, DEFAULT))).toBe(true)
    }
  })
})

describe('requestQueryKeys', () => {
  test('reports which parameters were present, in a stable order', () => {
    expect(requestQueryKeys({ sessionId: 's', projectId: 'p' })).toBe('projectId,sessionId')
    expect(requestQueryKeys({ projectId: 'p', sessionId: 's' })).toBe('projectId,sessionId')
  })

  test('distinguishes a scoped read from an unscoped one', () => {
    expect(requestQueryKeys({})).toBe('')
    expect(requestQueryKeys({ projectId: 'PRJ-2' })).toBe('projectId')
  })

  // The guard that matters: this server's OAuth callback receives `?code=&state=`, so a
  // future "just log the whole query string" would write authorization codes to disk.
  test('never carries a value, including the OAuth callback secrets', () => {
    const logged = requestQueryKeys({ code: 'authorization-code', state: 'csrf-state' })
    expect(logged).toBe('code,state')
    expect(logged).not.toContain('authorization-code')
    expect(logged).not.toContain('csrf-state')
  })
})
