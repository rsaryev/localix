import { describe, expect, test } from 'bun:test'

import type { StoredMessagePayload } from '../../../../db/payload'
import { answeredRows, surfaceMiniApps, surfaceTools } from './surface-tools'

// Fixture mini app names: core code names no mini app (rule X4), and these rules are about any.
const BOARD = 'fixture-board'
const GAME = 'fixture-game'
const STORE = 'fixture-store'
const CHART = 'fixture-chart'

const row = (payload: Partial<StoredMessagePayload> & Pick<StoredMessagePayload, 'role'>) => ({
  payload: { id: crypto.randomUUID(), ...payload } as StoredMessagePayload,
})
/** A message the person sent with the given mini app tabs linked. */
const said = (...miniApps: string[]) =>
  row({
    role: 'user',
    content: 'hi',
    bindings: miniApps.map((miniApp, index) => ({
      kind: 'context' as const,
      id: `b${index}`,
      source: 'active-tab' as const,
      miniApp,
      target: { kind: 'snippet', token: `@snippet:${miniApp}`, label: miniApp },
      resolution: { status: 'resolved' as const, contributions: [] },
    })),
  })
const reply = () => row({ role: 'assistant', content: 'ok' })
const woken = (miniApps?: string[]) =>
  row({ role: 'user', content: 'wake', isInternal: true, ...(miniApps ? { miniApps } : {}) })

describe('what the turn answers', () => {
  test('the latest run of user rows, past the replies that follow it', () => {
    const first = said(BOARD)
    const second = woken()
    const history = [said(GAME), reply(), first, second, reply()]
    expect(answeredRows(history)).toEqual([first, second])
    expect(answeredRows([reply()])).toEqual([])
  })
})

describe('the mini apps a turn brings', () => {
  test('the tabs linked to the person’s latest message', () => {
    expect(surfaceMiniApps([said(GAME), reply(), said(STORE, CHART)])).toEqual([STORE, CHART])
  })

  test('a tab closed before the next message brings nothing', () => {
    expect(surfaceMiniApps([said(STORE), reply(), said()])).toEqual([])
  })

  // A report or a job's exit wakes the session with a row that carries no tabs; reading only that
  // row flipped the tool list off and on between every report and reply — a cache miss each time.
  test('a wake with no tabs keeps the tabs the person last had open', () => {
    expect(surfaceMiniApps([said(BOARD), reply(), woken(), reply(), woken()])).toEqual([BOARD])
  })

  test('a mini app’s wake brings its mini app to the turn that answers it, and only to that turn', () => {
    expect(surfaceMiniApps([said(), reply(), woken([GAME])])).toEqual([GAME])
    expect(surfaceMiniApps([said(), reply(), woken([GAME]), reply(), said()])).toEqual([])
  })

  test('a /clear ends the context the tabs came from', () => {
    const cleared = row({ role: 'user', content: '/clear', contextBoundary: true })
    expect(surfaceMiniApps([said(STORE), reply(), cleared, woken()])).toEqual([])
  })

  test('a binding a mini app did not own brings nothing', () => {
    const file = row({
      role: 'user',
      content: 'look',
      bindings: [
        {
          kind: 'context',
          id: 'f',
          source: 'active-tab',
          target: { kind: 'file', token: '@file:a.ts', label: 'a.ts' },
          resolution: { status: 'resolved', contributions: [] },
        },
      ],
    })
    expect(surfaceMiniApps([file])).toEqual([])
  })
})

describe('the tools they bring', () => {
  const loaded = [
    { name: STORE, toolNames: ['store_schema', 'store_query', 'store_browse'] },
    { name: BOARD, toolNames: ['board_cards'] },
  ]

  test('every tool each mini app registered on this load, by name', () => {
    expect(surfaceTools([BOARD, STORE], loaded)).toEqual([
      'board_cards',
      'store_browse',
      'store_query',
      'store_schema',
    ])
    // The same set in another rank order is the same list: moving focus is not a cache miss.
    expect(surfaceTools([STORE, BOARD], loaded)).toEqual(surfaceTools([BOARD, STORE], loaded))
  })

  test('a mini app that is not loaded brings nothing', () => {
    expect(surfaceTools(['uninstalled'], loaded)).toEqual([])
  })
})
