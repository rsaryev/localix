/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import { resolveAgentTerminal } from './agent-scope'
import type { TerminalSession } from './session'

/**
 * The agent's terminal boundary, which is narrower than the user's.
 *
 * `ownedBy` in the service is `s?.userId === userId` — no session component — and the
 * agent action wiring passed only `{ userId, terminalId }`. `list` was session-filtered
 * and the four actions were not, so `write` in particular meant one session could type
 * into another session's live interactive program.
 */
const term = (over: Partial<TerminalSession> = {}): TerminalSession =>
  ({ id: 't1', userId: 'u1', chatSessionId: 's1', command: 'psql', ...over }) as TerminalSession

function fixture(sessions: TerminalSession[]) {
  const calls: string[] = []
  return {
    calls,
    // The service's real shape: user-scoped, session-blind.
    get: (userId: string, terminalId: string) => {
      calls.push(terminalId)
      const s = sessions.find((x) => x.id === terminalId)
      return s?.userId === userId ? s : undefined
    },
  }
}

describe('resolveAgentTerminal', () => {
  test('its own session’s terminal resolves', () => {
    const f = fixture([term()])
    expect(
      resolveAgentTerminal({ get: f.get, userId: 'u1', sessionId: 's1', terminalId: 't1' })?.id,
    ).toBe('t1')
  })

  test('another SESSION’s terminal does not, even for the same user', () => {
    // The gap that let one chat drive another chat's PTY.
    const f = fixture([term({ chatSessionId: 's2' })])
    expect(
      resolveAgentTerminal({ get: f.get, userId: 'u1', sessionId: 's1', terminalId: 't1' }),
    ).toBeUndefined()
  })

  test('another USER’s terminal does not', () => {
    const f = fixture([term({ userId: 'u2', chatSessionId: 's1' })])
    expect(
      resolveAgentTerminal({ get: f.get, userId: 'u1', sessionId: 's1', terminalId: 't1' }),
    ).toBeUndefined()
  })

  test('a terminal bound to NO chat is unreachable by an agent', () => {
    // A pane the human opened from the terminal panel has no chatSessionId. The human may
    // use it; an agent has no session claim on it.
    const f = fixture([term({ chatSessionId: null })])
    expect(
      resolveAgentTerminal({ get: f.get, userId: 'u1', sessionId: 's1', terminalId: 't1' }),
    ).toBeUndefined()
  })

  test('a session-less agent can address nothing, and never even looks', () => {
    const f = fixture([term()])
    expect(
      resolveAgentTerminal({ get: f.get, userId: 'u1', sessionId: null, terminalId: 't1' }),
    ).toBeUndefined()
    // Short-circuits before the lookup: with no session there is no claim to check.
    expect(f.calls).toEqual([])
  })

  test('an unknown id resolves to nothing rather than throwing', () => {
    const f = fixture([])
    expect(
      resolveAgentTerminal({ get: f.get, userId: 'u1', sessionId: 's1', terminalId: 'nope' }),
    ).toBeUndefined()
  })
})
