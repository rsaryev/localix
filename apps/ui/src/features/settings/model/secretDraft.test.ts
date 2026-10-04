import { describe, expect, test } from 'bun:test'

import {
  SECRET_KEY_MAX_LENGTH,
  SECRET_VALUE_MAX_LENGTH,
  canSubmitSecret,
  secretKeyError,
  secretValueError,
} from './secretDraft'

/**
 * The bug: the form mirrored only the server's key REGEX — no length cap on the key,
 * none on the value. A 129-character key therefore looked valid, enabled "Add", and
 * then 400'd on the server. Half a mirrored rule is a rule that drifts.
 */
describe('secretDraft — the form enforces the server limits, not half of them', () => {
  test('a key one character over the cap is rejected CLIENT-side', () => {
    const over = 'A'.repeat(SECRET_KEY_MAX_LENGTH + 1)
    expect(over.length).toBe(129) // the reported repro, spelled out
    expect(secretKeyError(over)).not.toBeNull()
    expect(canSubmitSecret(over, 'some-value')).toBe(false)
  })

  test('a key exactly at the cap is still accepted', () => {
    const at = 'A'.repeat(SECRET_KEY_MAX_LENGTH)
    expect(secretKeyError(at)).toBeNull()
    expect(canSubmitSecret(at, 'some-value')).toBe(true)
  })

  test('an over-long value is rejected client-side too', () => {
    const over = 'v'.repeat(SECRET_VALUE_MAX_LENGTH + 1)
    expect(secretValueError(over)).not.toBeNull()
    expect(canSubmitSecret('KEY', over)).toBe(false)
    expect(canSubmitSecret('KEY', 'v'.repeat(SECRET_VALUE_MAX_LENGTH))).toBe(true)
  })

  test('the charset rule still holds, and an empty key is not an error — just not ready', () => {
    expect(secretKeyError('has space')).not.toBeNull()
    expect(secretKeyError('PROD_DB.PASSWORD-1')).toBeNull()
    // An untouched field must not shout at the user before they have typed.
    expect(secretKeyError('')).toBeNull()
    expect(canSubmitSecret('', 'v')).toBe(false)
    expect(canSubmitSecret('KEY', '')).toBe(false)
  })
})
