import { describe, expect, test } from 'bun:test'

import type { StoredMessagePayload } from '../../../../db/payload'
import { answeredRows, surfacePlugins, surfaceTools } from './surface-tools'

// Fixture plugin names: core code must not name a bundled plugin, tests included
// (`scripts/plugin-identity-guard.mjs`), and these rules are about any plugin.
const BOARD = 'fixture-board'
const GAME = 'fixture-game'
const STORE = 'fixture-store'
const CHART = 'fixture-chart'

const row = (payload: Partial<StoredMessagePayload> & Pick<StoredMessagePayload, 'role'>) => ({
  payload: { id: crypto.randomUUID(), ...payload } as StoredMessagePayload,
})
/** A message the person sent with the given plugin tabs linked. */
const said = (...plugins: string[]) =>
  row({
    role: 'user',
    content: 'hi',
    bindings: plugins.map((plugin, index) => ({
      kind: 'context' as const,
      id: `b${index}`,
      source: 'active-tab' as const,
      plugin,
      target: { kind: 'snippet', token: `@snippet:${plugin}`, label: plugin },
      resolution: { status: 'resolved' as const, contributions: [] },
    })),
  })
const reply = () => row({ role: 'assistant', content: 'ok' })
const woken = (plugins?: string[]) =>
  row({ role: 'user', content: 'wake', isInternal: true, ...(plugins ? { plugins } : {}) })

describe('what the turn answers', () => {
  test('the latest run of user rows, past the replies that follow it', () => {
    const first = said(BOARD)
    const second = woken()
    const history = [said(GAME), reply(), first, second, reply()]
    expect(answeredRows(history)).toEqual([first, second])
    expect(answeredRows([reply()])).toEqual([])
  })
})

describe('the plugins a turn brings', () => {
  test('the tabs linked to the person’s latest message', () => {
    expect(surfacePlugins([said(GAME), reply(), said(STORE, CHART)])).toEqual([STORE, CHART])
  })

  test('a tab closed before the next message brings nothing', () => {
    expect(surfacePlugins([said(STORE), reply(), said()])).toEqual([])
  })

  // A report or a job's exit wakes the session with a row that carries no tabs; reading only that
  // row flipped the tool list off and on between every report and reply — a cache miss each time.
  test('a wake with no tabs keeps the tabs the person last had open', () => {
    expect(surfacePlugins([said(BOARD), reply(), woken(), reply(), woken()])).toEqual([BOARD])
  })

  test('a plugin’s wake brings its plugin to the turn that answers it, and only to that turn', () => {
    expect(surfacePlugins([said(), reply(), woken([GAME])])).toEqual([GAME])
    expect(surfacePlugins([said(), reply(), woken([GAME]), reply(), said()])).toEqual([])
  })

  test('a /clear ends the context the tabs came from', () => {
    const cleared = row({ role: 'user', content: '/clear', contextBoundary: true })
    expect(surfacePlugins([said(STORE), reply(), cleared, woken()])).toEqual([])
  })

  test('a binding a plugin did not own brings nothing', () => {
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
    expect(surfacePlugins([file])).toEqual([])
  })
})

describe('the tools they bring', () => {
  const loaded = [
    { name: STORE, toolNames: ['store_schema', 'store_query', 'store_browse'] },
    { name: BOARD, toolNames: ['board_cards'] },
  ]

  test('every tool each plugin registered on this load, by name', () => {
    expect(surfaceTools([BOARD, STORE], loaded)).toEqual([
      'board_cards',
      'store_browse',
      'store_query',
      'store_schema',
    ])
    // The same set in another rank order is the same list: moving focus is not a cache miss.
    expect(surfaceTools([STORE, BOARD], loaded)).toEqual(surfaceTools([BOARD, STORE], loaded))
  })

  test('a plugin that is not loaded brings nothing', () => {
    expect(surfaceTools(['uninstalled'], loaded)).toEqual([])
  })
})
