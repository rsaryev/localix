/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import { agentTerminalReader, resolveAgentTerminal, watchAgentTerminal } from './agent-scope'
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

describe('watchAgentTerminal', () => {
  /** A pane whose output and exit listeners the test fires by hand. */
  function pane(over: Partial<TerminalSession> = {}) {
    const data = new Set<(chunk: string) => void>()
    const exit = new Set<(code: number) => void>()
    const session = term({
      subscribe: (listener: (chunk: string) => void) => {
        data.add(listener)
        return () => data.delete(listener)
      },
      onExit: (listener: (code: number) => void) => {
        exit.add(listener)
        return () => exit.delete(listener)
      },
      ...over,
    } as Partial<TerminalSession>)
    return { session, data, exit }
  }

  test('its own session’s pane reports output and exit until released', () => {
    const p = pane()
    const events: string[] = []
    const release = watchAgentTerminal(
      { get: () => p.session },
      { userId: 'u1', sessionId: 's1', terminalId: 't1' },
      (event) => events.push(event),
    )
    for (const listener of p.data) listener('chunk')
    for (const listener of p.exit) listener(0)
    expect(events).toEqual(['output', 'exit'])
    release?.()
    expect(p.data.size + p.exit.size).toBe(0)
  })

  test('another session’s pane cannot be watched', () => {
    const p = pane({ chatSessionId: 's2' })
    expect(
      watchAgentTerminal(
        { get: () => p.session },
        { userId: 'u1', sessionId: 's1', terminalId: 't1' },
        () => {},
      ),
    ).toBeNull()
    expect(p.data.size).toBe(0)
  })
})

describe('agentTerminalReader', () => {
  const SCREEN = { text: 'DONE', cursor: { row: 0, col: 0 }, cols: 80, rows: 24 }
  // The service once a pane has exited: `get` no longer finds it, the archive does.
  const exited = (over: Partial<TerminalSession> = {}) => {
    const archived = term(over)
    return {
      get: () => undefined,
      archivedTerminal: (userId: string, id: string) =>
        archived.userId === userId && archived.id === id ? archived : undefined,
      finalScreen: async () => SCREEN,
      list: () => [],
    }
  }

  test('the final screen of its own session’s exited pane', async () => {
    const reader = agentTerminalReader(() => exited())
    expect(await reader.finalScreen({ userId: 'u1', sessionId: 's1', terminalId: 't1' })).toBe(
      SCREEN,
    )
  })

  test('no final screen for another session’s pane, without a session, or without the service', async () => {
    const input = { userId: 'u1', sessionId: 's1', terminalId: 't1' }
    expect(
      await agentTerminalReader(() => exited({ chatSessionId: 's2' })).finalScreen(input),
    ).toBeNull()
    expect(
      await agentTerminalReader(() => exited()).finalScreen({ ...input, sessionId: null }),
    ).toBeNull()
    expect(
      await agentTerminalReader(() => exited()).finalScreen({ ...input, userId: 'u2' }),
    ).toBeNull()
    expect(await agentTerminalReader(() => undefined).finalScreen(input)).toBeNull()
  })

  test('lists only the session’s own live panes', () => {
    const reader = agentTerminalReader(() => ({
      ...exited(),
      list: () => [
        { id: 't1', chatSessionId: 's1', command: 'psql' },
        { id: 't2', chatSessionId: 's2', command: 'vim' },
      ],
    }))
    expect(reader.list({ userId: 'u1', sessionId: 's1' })).toEqual([
      { terminalId: 't1', command: 'psql' },
    ])
    expect(agentTerminalReader(() => undefined).list({ userId: 'u1', sessionId: 's1' })).toEqual([])
  })
})
