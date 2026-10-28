import { describe, expect, test } from 'bun:test'
import {
  observeToolCall,
  OPEN_ACTIONS,
  SCREEN_ACTIONS,
  CLOSE_ACTIONS,
  IGNORED_ACTIONS,
} from './observe'
import { LiveStore } from './store'
import { ManifestRegistry } from '../detection/registry'

function makeStore(): LiveStore {
  return new LiveStore(new ManifestRegistry('/nonexistent-state-dir', () => {}))
}

function open(store: LiveStore, terminalId: string, command: string): void {
  observeToolCall(
    { live: store, onOpened: () => {}, log: () => {} },
    {
      toolName: 'Bash',
      input: {},
      result: { content: '', details: { action: 'open', terminalId, command, screen: '' } },
      sessionId: 'lx1',
    },
  )
}

const LAUNCH_LINE =
  `LOCALIX_AGENT=claude-code LOCALIX_AGENT_CWD='/Users/dev/dir with space' ` +
  `claude --dangerously-skip-permissions`

describe('the action partition stays total over the host catalog', () => {
  /**
   * The observer classifies the bash tool's interactive actions into open / screen / close, and
   * deliberately treats `list` as none of those. That partition is a judgement about the host's
   * catalog, and a judgement can go stale in one direction that nothing notices: a NEW interactive
   * action which renders a screen would simply be ignored, the live half would see less than before,
   * and no test, type or gate would fail.
   *
   * So the guard is totality, checked against the host's own list rather than a copy of it. A test
   * may reach into `apps/api/src` where production plugin code may not — `check-architecture.mjs`
   * exempts test sources for exactly this kind of contract.
   */
  test('every interactive action the host declares is classified or explicitly ignored', async () => {
    const { INTERACTIVE_ACTIONS } = await import('../../../agent-core/tools/terminal/terminal')
    const classified = new Set([
      ...OPEN_ACTIONS,
      ...SCREEN_ACTIONS,
      ...CLOSE_ACTIONS,
      ...IGNORED_ACTIONS,
    ])

    const unclassified = INTERACTIVE_ACTIONS.filter((action) => !classified.has(action))
    expect(
      unclassified,
      `These bash terminal actions are neither observed nor explicitly ignored:\n  ${unclassified.join(', ')}\n` +
        'Add each to OPEN/SCREEN/CLOSE_ACTIONS, or to IGNORED_ACTIONS with the reason it carries no observation.',
    ).toEqual([])

    // The other direction: a name we classify that the host no longer has is a stale entry, and it
    // would quietly stop matching anything.
    const strangers = [...classified].filter(
      (action) => !(INTERACTIVE_ACTIONS as readonly string[]).includes(action),
    )
    expect(
      strangers,
      `Classified actions the host no longer declares: ${strangers.join(', ')}`,
    ).toEqual([])
  })
})

describe('observing a launch', () => {
  test('the declarations on the launch line land on the entry', () => {
    const store = makeStore()
    open(store, 't1', LAUNCH_LINE)
    const entry = store.get('t1')
    expect(entry?.provider).toBe('claude-code')
    expect(entry?.cwd).toBe('/Users/dev/dir with space')
  })

  test('a launch that declares nothing leaves the cwd undefined, not empty', () => {
    const store = makeStore()
    open(store, 't2', 'codex')
    const entry = store.get('t2')
    expect(entry?.provider).toBe('codex')
    expect(entry?.cwd).toBeUndefined()
  })
})

describe('a transcript reading answers only where the screen gave up', () => {
  /**
   * The guards matter more than the reading. A manifest that MATCHED saw something positive on the
   * screen — a permission prompt above all, which no transcript can show, because nothing is written
   * while one waits. So this may only speak into the degraded case, which for Claude Code is every
   * non-blocked screen and is exactly where a wait used to settle on a working agent.
   */
  /** `byTerminal` is the store's private map; a test reads what a caller reads. */
  function entryOf(store: LiveStore, terminalId: string) {
    return store.list().find((entry) => entry.terminalId === terminalId)
  }

  function degraded(): { store: LiveStore; terminalId: string } {
    const store = makeStore()
    open(store, 't1', LAUNCH_LINE)
    // No manifest is loaded from '/nonexistent-state-dir', so any screen degrades to the fallback.
    store.observeScreen('t1', 'some screen with no matching rule')
    return { store, terminalId: 't1' }
  }

  test('the degraded state is the one it replaces', () => {
    const { store } = degraded()

    expect(entryOf(store, 't1')?.state).toBe('idle')
    expect(entryOf(store, 't1')?.explain.fallbackReason).toBeDefined()
  })

  test('a mid-turn log turns the guess into a reading', () => {
    const { store } = degraded()

    store.observeTurn('t1', 'working', Date.now())

    const entry = entryOf(store, 't1')
    expect(entry?.state).toBe('working')
    expect(entry?.explain.authority).toBe('transcript')
    // The guess is gone, not merely relabelled: a caller filtering on it must stop seeing this key.
    expect(entry?.explain.fallbackReason).toBeUndefined()
  })

  test('a matched rule outranks it, because a screen can show what no file can', () => {
    // A permission prompt is written NOWHERE: nothing is appended while one waits, so the log of a
    // blocked agent looks exactly like the log of a working one. The manifest saw it; that wins.
    const store = makeStore()
    open(store, 't1', LAUNCH_LINE)
    store.observeScreen(
      't1',
      [
        '────────────',
        'Do you want to proceed?',
        'tab/arrow keys to navigate',
        'enter to select · esc to cancel',
      ].join('\n'),
    )
    const matched = entryOf(store, 't1')
    expect(matched?.state).toBe('blocked')
    expect(matched?.explain.fallbackReason).toBeUndefined()

    store.observeTurn('t1', 'working', Date.now())

    expect(entryOf(store, 't1')?.state).toBe('blocked')
    expect(entryOf(store, 't1')?.explain.authority).toBe('screen-manifest')
  })

  test('a closed terminal is not reopened by its file', () => {
    const { store } = degraded()
    store.close('t1')

    // `close` settles the entry to `done` and drops it from the live list; the reading must not
    // resurrect it, so the method declines rather than writing to a finished delegation.
    expect(store.observeTurn('t1', 'working', Date.now())).toBeUndefined()
    expect(entryOf(store, 't1')).toBeUndefined()
  })

  test('a later screen reading takes the entry back, so a prompt is never missed', () => {
    const { store } = degraded()
    store.observeTurn('t1', 'working', Date.now())

    store.observeScreen('t1', 'a different screen')

    // The manifest is authoritative whenever it has anything to say; the transcript only fills in
    // for its silence, and must not latch.
    expect(entryOf(store, 't1')?.explain.authority).toBe('screen-manifest')
  })
})
