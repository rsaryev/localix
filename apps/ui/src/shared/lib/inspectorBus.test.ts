import { afterEach, describe, expect, test } from 'bun:test'

import {
  autoReveal,
  inspector,
  notifyInspectorOpenChange,
  registerInspectorHandler,
  type InspectorRequest,
} from './inspectorBus'

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

function capture() {
  const calls: InspectorRequest[] = []
  cleanup = registerInspectorHandler((r) => calls.push(r))
  return calls
}

describe('inspector request channel', () => {
  test('no-ops (no throw) when no handler is registered', () => {
    expect(() => inspector.openFile({ sessionId: 's1', path: 'a.ts' })).not.toThrow()
  })

  test('each opener forwards the correctly-shaped request, naming its chat', () => {
    const calls = capture()
    inspector.openFile({ sessionId: 's1', path: 'src/a.ts' })
    inspector.openMediaFile({ sessionId: 's1', mediaId: 'm1', name: 'a.pdf' })
    inspector.openDiff({ sessionId: 's1', path: 'b.ts', diff: '@@', title: 'B' })
    inspector.openPreview({ url: 'http://x', version: 3, sessionId: 's1' })
    inspector.showLiveFileChange({
      sessionId: 's1',
      toolCallId: 'tc1',
      path: 'c.ts',
      title: 'c.ts',
      code: 'x',
      mode: 'write',
      startedAt: 12,
    })
    inspector.clearLiveFileChange('tc1')
    inspector.openStats()
    inspector.openWorkItem({ workKind: 'board', id: 'board', title: 'Board', scope: 's1' })
    inspector.openGlobalSearch('s1', 'needle')
    expect(calls).toEqual([
      { kind: 'file', sessionId: 's1', path: 'src/a.ts' },
      { kind: 'media-file', sessionId: 's1', mediaId: 'm1', name: 'a.pdf' },
      { kind: 'diff', sessionId: 's1', path: 'b.ts', diff: '@@', title: 'B' },
      { kind: 'preview', url: 'http://x', version: 3, sessionId: 's1' },
      {
        kind: 'live-file-change',
        change: {
          sessionId: 's1',
          toolCallId: 'tc1',
          path: 'c.ts',
          title: 'c.ts',
          code: 'x',
          mode: 'write',
          startedAt: 12,
        },
      },
      { kind: 'clear-live-file-change', toolCallId: 'tc1' },
      { kind: 'stats' },
      { kind: 'work-item', workKind: 'board', id: 'board', title: 'Board', scope: 's1' },
      { kind: 'global-search', sessionId: 's1', query: 'needle' },
    ])
  })

  test('openFile carries an optional 1-indexed line', () => {
    const calls = capture()
    inspector.openFile({ sessionId: 's1', path: 'src/a.ts', line: 42 })
    expect(calls[0]).toEqual({ kind: 'file', sessionId: 's1', path: 'src/a.ts', line: 42 })
  })

  test('openFile forwards the solo flag (distraction-free open)', () => {
    const calls = capture()
    inspector.openFile({ sessionId: 's1', path: 'src/a.ts', solo: true })
    expect(calls[0]).toMatchObject({ kind: 'file', path: 'src/a.ts', solo: true })
  })

  test('openFile forwards an exact range (start column + end position)', () => {
    const calls = capture()
    inspector.openFile({
      sessionId: 's1',
      path: 'src/a.ts',
      line: 42,
      column: 4,
      endLine: 42,
      endColumn: 12,
    })
    expect(calls[0]).toEqual({
      kind: 'file',
      sessionId: 's1',
      path: 'src/a.ts',
      line: 42,
      column: 4,
      endLine: 42,
      endColumn: 12,
    })
  })

  test('isOpen reads the registered inspector state without opening anything', () => {
    expect(inspector.isOpen()).toBe(false)
    cleanup = registerInspectorHandler(() => {}, { isOpen: () => true })
    expect(inspector.isOpen()).toBe(true)
    cleanup()
    cleanup = null
    expect(inspector.isOpen()).toBe(false)
  })

  test('subscribeOpenChange observes registered and explicit open-state notifications', () => {
    let open = false
    const values: boolean[] = []
    const unsubscribe = inspector.subscribeOpenChange(() => values.push(inspector.isOpen()))

    cleanup = registerInspectorHandler(() => {}, { isOpen: () => open })
    open = true
    notifyInspectorOpenChange()
    open = false
    notifyInspectorOpenChange()
    unsubscribe()
    open = true
    notifyInspectorOpenChange()

    expect(values).toEqual([false, true, false])
  })

  test("openTerminal forwards the chat whose terminal it opens, and a profile's command", () => {
    const calls = capture()
    inspector.openTerminal('sess-1')
    inspector.openTerminal('sess-2', { command: 'htop', title: 'Top' })
    expect(calls).toEqual([
      { kind: 'terminal', sessionId: 'sess-1' },
      { kind: 'terminal', sessionId: 'sess-2', command: 'htop', title: 'Top' },
    ])
  })

  test('unsubscribe stops delivery', () => {
    const calls = capture()
    inspector.openFile({ sessionId: 's1', path: 'one' })
    cleanup?.()
    cleanup = null
    inspector.openFile({ sessionId: 's1', path: 'two' })
    expect(calls.map((c) => (c as { path: string }).path)).toEqual(['one'])
  })

  describe('autoReveal — the focus-preserving policy gate', () => {
    function captureWithOpen(open: boolean) {
      const calls: InspectorRequest[] = []
      cleanup = registerInspectorHandler((r) => calls.push(r), { isOpen: () => open })
      return calls
    }

    test('a closed inspector swallows a normal reveal (never pops the panel open)', () => {
      const calls = captureWithOpen(false)
      autoReveal({ kind: 'stats' })
      autoReveal({ kind: 'file', sessionId: 's1', path: 'a.ts' })
      expect(calls).toEqual([])
    })

    test('an open inspector forwards a normal reveal', () => {
      const calls = captureWithOpen(true)
      autoReveal({ kind: 'stats' })
      expect(calls).toEqual([{ kind: 'stats' }])
    })

    test('an important reveal lands even into a closed inspector', () => {
      const calls = captureWithOpen(false)
      autoReveal(
        { kind: 'preview', url: 'http://x', version: 1, sessionId: 's1' },
        { important: true },
      )
      expect(calls).toEqual([{ kind: 'preview', url: 'http://x', version: 1, sessionId: 's1' }])
    })
  })

  test('a stale unsubscribe does not clobber a newer handler', () => {
    const first: InspectorRequest[] = []
    const unsubFirst = registerInspectorHandler((r) => first.push(r))
    const second: InspectorRequest[] = []
    cleanup = registerInspectorHandler((r) => second.push(r)) // replaces first

    unsubFirst() // stale: handler is now `second`, so this must be a no-op
    inspector.openFile({ sessionId: 's1', path: 'x' })
    expect(second).toHaveLength(1) // newer handler still active
    expect(first).toHaveLength(0)
  })
})
