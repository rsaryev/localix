import { describe, expect, test } from 'bun:test'
import { SYSTEM_AUTHOR, USER_AUTHOR } from '../../../db'
import type { PersistedMessage } from '../contracts'
import { RECAP_AFTER_MS, recapEligibility } from './eligibility'

const T0 = Date.parse('2026-10-25T10:00:00.000Z')

function row(
  id: string,
  at: number,
  payload: Partial<PersistedMessage['payload']> & Pick<PersistedMessage['payload'], 'role'>,
): PersistedMessage {
  const iso = new Date(at).toISOString()
  return {
    id,
    sessionId: 's',
    userId: 'u',
    createdAt: iso,
    updatedAt: iso,
    payload: { id, from: USER_AUTHOR, content: id, ...payload } as never,
  }
}

const recapRow = (id: string, at: number) =>
  row(id, at, {
    role: 'user',
    from: SYSTEM_AUTHOR,
    uiOnly: true,
    systemNotice: { kind: 'session_recap', tone: 'neutral', text: 'Earlier recap.' },
  })

/** n finished exchanges, the last reply finishing at `lastAt`. */
function exchanges(n: number, lastAt: number): PersistedMessage[] {
  return Array.from({ length: n }, (_, i) => {
    const at = lastAt - (n - 1 - i) * 60_000
    return [
      row(`u${i}`, at - 1000, { role: 'user' }),
      row(`a${i}`, at, { role: 'assistant', from: 'agent:lead' as never }),
    ]
  }).flat()
}

const base = { enabled: true, running: false, nowMs: T0 + RECAP_AFTER_MS }

describe('automatic recap', () => {
  test('is due once three minutes have passed since the last finished turn', () => {
    expect(recapEligibility({ ...base, trigger: 'auto', rows: exchanges(3, T0) })).toEqual({
      ok: true,
    })
  })

  test('waits until the break is three minutes long', () => {
    const nowMs = T0 + RECAP_AFTER_MS - 1
    expect(recapEligibility({ ...base, nowMs, trigger: 'auto', rows: exchanges(3, T0) })).toEqual({
      ok: false,
      reason: 'too-soon',
    })
  })

  test('needs three turns in the session', () => {
    expect(recapEligibility({ ...base, trigger: 'auto', rows: exchanges(2, T0) })).toEqual({
      ok: false,
      reason: 'too-few-turns',
    })
  })

  test('never comes twice in a row', () => {
    const rows = [...exchanges(3, T0), recapRow('r', T0 + 1000)]
    expect(recapEligibility({ ...base, trigger: 'auto', rows })).toEqual({
      ok: false,
      reason: 'already-recapped',
    })
  })

  test('comes again after a new turn finished', () => {
    const rows = [
      ...exchanges(3, T0),
      recapRow('r', T0 + 1000),
      row('u9', T0 + 2000, { role: 'user' }),
      row('a9', T0 + 3000, { role: 'assistant' }),
    ]
    const nowMs = T0 + 3000 + RECAP_AFTER_MS
    expect(recapEligibility({ ...base, nowMs, trigger: 'auto', rows })).toEqual({ ok: true })
  })

  test('is skipped when the person switched recaps off, or a turn is running', () => {
    const rows = exchanges(3, T0)
    expect(recapEligibility({ ...base, enabled: false, trigger: 'auto', rows })).toEqual({
      ok: false,
      reason: 'disabled',
    })
    expect(recapEligibility({ ...base, running: true, trigger: 'auto', rows })).toEqual({
      ok: false,
      reason: 'running',
    })
  })

  test('does not count command output or hidden internal turns as turns', () => {
    const rows = [
      ...exchanges(2, T0 - 10_000),
      row('i', T0 - 5000, { role: 'assistant', isInternal: true }),
      row('c', T0, {
        role: 'assistant',
        uiOnly: true,
        commandOutput: { command: '/usage', tone: 'neutral' },
      }),
    ]
    expect(recapEligibility({ ...base, trigger: 'auto', rows })).toEqual({
      ok: false,
      reason: 'too-few-turns',
    })
  })
})

describe('recap on demand', () => {
  const ask = { enabled: false, running: false, nowMs: T0, trigger: 'command' as const }

  test('works at any time, even with automatic recaps off, after one finished turn', () => {
    expect(recapEligibility({ ...ask, rows: exchanges(1, T0) })).toEqual({ ok: true })
    expect(recapEligibility({ ...ask, rows: [...exchanges(3, T0), recapRow('r', T0)] })).toEqual({
      ok: true,
    })
  })

  test('has nothing to recap before the first reply, or while a turn runs', () => {
    expect(recapEligibility({ ...ask, rows: [] })).toEqual({ ok: false, reason: 'too-few-turns' })
    expect(recapEligibility({ ...ask, running: true, rows: exchanges(3, T0) })).toEqual({
      ok: false,
      reason: 'running',
    })
  })
})
