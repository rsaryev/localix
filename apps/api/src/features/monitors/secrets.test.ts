import { describe, expect, test } from 'bun:test'

import { resolveSecretEnv, secretEnvName, SECRET_ENV_PREFIX, substituteSecretEnv } from './secrets'

describe('secretEnvName', () => {
  test('folds vault-legal characters a shell cannot name', () => {
    // Vault keys allow `.` and `-`; env names do not. Both the command rewrite and the env map
    // go through this one function, so they cannot disagree about the result.
    expect(secretEnvName('MSGR_TOKEN')).toBe(`${SECRET_ENV_PREFIX}MSGR_TOKEN`)
    expect(secretEnvName('msgr.api-token')).toBe(`${SECRET_ENV_PREFIX}MSGR_API_TOKEN`)
  })
})

describe('substituteSecretEnv', () => {
  test('replaces the reference with an env reference and reports the key', async () => {
    const { command, keys } = await substituteSecretEnv(
      'curl -sf -H "Authorization: Bearer ${secret:MSGR_TOKEN}" https://msgr/api',
    )
    expect(command).toBe(
      'curl -sf -H "Authorization: Bearer $LOCALIX_SECRET_MSGR_TOKEN" https://msgr/api',
    )
    expect(keys).toEqual(['MSGR_TOKEN'])
    // The whole point: nothing here can produce a string containing a VALUE.
    expect(command).not.toContain('secret:')
  })

  test('handles several keys and repeats, in first-seen order', async () => {
    const { command, keys } = await substituteSecretEnv(
      'curl -u ${secret:USER}:${secret:PASS} -H "X-Extra: ${secret:USER}" https://x',
    )
    expect(keys).toEqual(['USER', 'PASS'])
    expect(command).toBe(
      'curl -u $LOCALIX_SECRET_USER:$LOCALIX_SECRET_PASS -H "X-Extra: $LOCALIX_SECRET_USER" https://x',
    )
  })

  test('leaves a command with no references untouched', async () => {
    const raw = 'gh run view 123 --json status'
    const { command, keys } = await substituteSecretEnv(raw)
    expect(command).toBe(raw)
    expect(keys).toEqual([])
  })
})

describe('resolveSecretEnv', () => {
  test('maps every key to its env var', async () => {
    const resolved = await resolveSecretEnv(['MSGR_TOKEN'], async () => 'super-secret')
    expect(resolved).toEqual({
      ok: true,
      env: { [`${SECRET_ENV_PREFIX}MSGR_TOKEN`]: 'super-secret' },
    })
  })

  test('a missing key fails the whole resolution and names it', async () => {
    // Refusing at start is the point: a check that polls with an empty credential gets 401
    // forever and reports nothing — indistinguishable from "still waiting".
    const resolved = await resolveSecretEnv(['A', 'B'], async (key) =>
      key === 'A' ? 'value' : undefined,
    )
    expect(resolved).toEqual({ ok: false, missing: ['B'] })
  })

  test('an EMPTY stored value counts as missing', async () => {
    const resolved = await resolveSecretEnv(['A'], async () => '')
    expect(resolved).toEqual({ ok: false, missing: ['A'] })
  })
})
