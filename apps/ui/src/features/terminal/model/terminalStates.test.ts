import { describe, expect, test } from 'bun:test'

import {
  applyTerminalState,
  forgetTerminalState,
  replaceTerminalStates,
  useTerminalStatesStore,
} from './terminalStates'

/**
 * Terminal state arrives PUSHED, and the slow registry poll must not undo it.
 *
 * Before `terminal.state` existed, an "Open preview" appeared only on the composer's next poll
 * (up to 4s). These pin the push path and the one hazard of having two writers: a poll answer
 * older than a push rolling it back.
 */
let n = 0
const ids = () => {
  n += 1
  return { session: `s-${n}`, terminal: `t-${n}` }
}
const rows = (session: string) => useTerminalStatesStore.getState().bySession[session] ?? []
const push = (session: string, terminal: string, altScreen: boolean, previewUrl?: string) =>
  applyTerminalState(session, {
    type: 'terminal.state',
    sessionId: session,
    terminalId: terminal,
    command: 'vim',
    altScreen,
    ...(previewUrl ? { previewUrl } : {}),
  })

describe('terminal state push', () => {
  test('a push upserts its own row and keeps the session’s other panes', () => {
    const { session, terminal } = ids()
    replaceTerminalStates(session, [{ terminalId: 'other', altScreen: false }], Date.now())
    push(session, terminal, true)
    expect(rows(session)).toEqual([
      { terminalId: 'other', altScreen: false },
      { terminalId: terminal, command: 'vim', altScreen: true },
    ])
  })

  test('a pushed served URL is the row the composer reads', () => {
    const { session, terminal } = ids()
    push(session, terminal, false, 'http://localhost:5173')
    expect(rows(session)).toEqual([
      {
        terminalId: terminal,
        command: 'vim',
        altScreen: false,
        previewUrl: 'http://localhost:5173',
      },
    ])
  })

  test('a poll answer requested before a push does not roll it back', () => {
    const { session, terminal } = ids()
    const requestedAt = Date.now() - 1_000
    push(session, terminal, true)
    replaceTerminalStates(session, [{ terminalId: terminal, altScreen: false }], requestedAt)
    expect(rows(session)[0]?.altScreen).toBe(true)
  })

  test('a pane pushed after the snapshot survives an answer that does not list it yet', () => {
    const { session, terminal } = ids()
    const requestedAt = Date.now() - 1_000
    push(session, terminal, false, 'http://localhost:3000')
    replaceTerminalStates(session, [], requestedAt)
    expect(rows(session).map((r) => r.terminalId)).toEqual([terminal])
  })

  test('a newer poll answer wins, and a pane missing from it is gone', () => {
    const { session, terminal } = ids()
    push(session, terminal, false, 'http://localhost:3000')
    replaceTerminalStates(session, [], Date.now() + 1)
    expect(rows(session)).toEqual([])
  })

  test('a finished pane loses its URL immediately', () => {
    const { session, terminal } = ids()
    push(session, terminal, false, 'http://localhost:8080')
    forgetTerminalState(session, terminal)
    expect(rows(session)).toEqual([])
  })
})
