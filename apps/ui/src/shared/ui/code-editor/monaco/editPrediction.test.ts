import { describe, expect, it } from 'bun:test'

import { registerEditPredictionAdapter } from './editPrediction'
import { OVERSIZED_PASTE_CHARS } from '../nextEditPredictionPolicy'
import type { EditorSuggestion } from '../types'
import type { NextEditController, NextEditRequest } from '../nextEditPrediction'

/**
 * FIRST tests for the LIVE edit-prediction driver.
 *
 * This 360-line adapter is what actually answers Tab in the editor, and it had no tests of
 * its own while ~450 lines covered a phase machine no production code ever called (removed in
 * `f18d77ed9`). That inversion is not academic: the paste-size defect fixed in `50476cceb`
 * — five characters pasted into a long line read as an oversized paste and silently suppressed
 * the prediction — lived here precisely because nothing exercised it.
 *
 * The fakes below implement only what the adapter touches. They are deliberately literal
 * about the parts where correctness lives: `getVersionId` really increments on every edit, and
 * `onDidChangeContent` really fires with per-change inserted text, because the adapter's
 * staleness guarantees are expressed in exactly those two things.
 */

type ContentListener = (event: {
  changes: Array<{ text: string; range: { startLineNumber: number; endLineNumber: number } }>
  isFlush: boolean
}) => void

/** The 1-based, pre-edit line span that differs between two texts — what Monaco reports. */
function changedLineRange(before: string[], after: string[]) {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  const startLineNumber = Math.min(head + 1, before.length)
  return { startLineNumber, endLineNumber: Math.max(startLineNumber, before.length - tail) }
}

function createFakeModel(initial: string) {
  let lines = initial.split('\n')
  let version = 1
  const contentListeners = new Set<ContentListener>()
  return {
    onDidChangeContent(listener: ContentListener) {
      contentListeners.add(listener)
      return { dispose: () => contentListeners.delete(listener) }
    },
    getValue: () => lines.join('\n'),
    getValueLength: () => lines.join('\n').length,
    getVersionId: () => version,
    getLineCount: () => lines.length,
    getLineContent: (line: number) => lines[line - 1] ?? '',
    getLineMaxColumn: (line: number) => (lines[line - 1]?.length ?? 0) + 1,
    /** Apply an edit the way a user would, then notify — version first, listeners after. */
    edit(next: string, inserted: string, isFlush = false) {
      const range = changedLineRange(lines, next.split('\n'))
      lines = next.split('\n')
      version += 1
      for (const listener of contentListeners) {
        listener({ changes: [{ text: inserted, range }], isFlush })
      }
    },
  }
}

function createFakeEditor() {
  const contextKeys = new Map<string, unknown>()
  let compositionStart = () => {}
  let compositionEnd = () => {}
  const revealed: number[] = []
  return {
    getId: () => 'editor-1',
    onDidCompositionStart(listener: () => void) {
      compositionStart = listener
      return { dispose: () => {} }
    },
    onDidCompositionEnd(listener: () => void) {
      compositionEnd = listener
      return { dispose: () => {} }
    },
    createContextKey<T>(name: string, initial: T) {
      contextKeys.set(name, initial)
      return {
        set: (value: T) => contextKeys.set(name, value),
        reset: () => contextKeys.delete(name),
      }
    },
    addAction: () => ({ dispose: () => {} }),
    revealLineInCenterIfOutsideViewport: (line: number) => revealed.push(line),
    contextKeys,
    revealed,
    startComposing: () => compositionStart(),
    stopComposing: () => compositionEnd(),
  }
}

const TRIGGER = { Automatic: 0, Explicit: 1 } as const
const END_OF_LIFE = { Accepted: 0, Rejected: 1, Ignored: 2 } as const

function createFakeMonaco() {
  let registered: any = null
  return {
    api: {
      Range: class {
        startLineNumber: number
        startColumn: number
        endLineNumber: number
        endColumn: number
        constructor(
          startLineNumber: number,
          startColumn: number,
          endLineNumber: number,
          endColumn: number,
        ) {
          this.startLineNumber = startLineNumber
          this.startColumn = startColumn
          this.endLineNumber = endLineNumber
          this.endColumn = endColumn
        }
      },
      KeyMod: { Alt: 512 },
      KeyCode: { BracketRight: 94, BracketLeft: 92 },
      languages: {
        InlineCompletionTriggerKind: TRIGGER,
        InlineCompletionHintStyle: { Label: 0 },
        InlineCompletionEndOfLifeReasonKind: END_OF_LIFE,
        registerInlineCompletionsProvider: (_language: string, provider: unknown) => {
          registered = provider
          return { dispose: () => {} }
        },
      },
    },
    provider: () => registered,
  }
}

const CANCELLED_TOKEN = {
  isCancellationRequested: true,
  onCancellationRequested: () => ({ dispose: () => {} }),
}
const LIVE_TOKEN = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
}

const hunk = (
  id: string,
  startLine: number,
  original: string,
  replacement: string,
): EditorSuggestion => ({
  id,
  kind: 'suggestion',
  source: 'edit-prediction',
  startLine,
  endLine: startLine,
  original,
  replacement,
})

const FILE = 'const a = 1\nconst b = 2\nconst c = 3'

interface Harness {
  model: ReturnType<typeof createFakeModel>
  editor: ReturnType<typeof createFakeEditor>
  provider: () => any
  requests: NextEditRequest[]
  published: Array<EditorSuggestion[] | null>
  adapter: ReturnType<typeof registerEditPredictionAdapter>
  controller: NextEditController
}

function harness(options?: { result?: EditorSuggestion[] | null; failures?: number }): Harness {
  const model = createFakeModel(FILE)
  const editor = createFakeEditor()
  const monaco = createFakeMonaco()
  const requests: NextEditRequest[] = []
  const published: Array<EditorSuggestion[] | null> = []
  const result: EditorSuggestion[] | null = options?.result ?? null
  const controller: NextEditController = {
    source: async (request) => {
      requests.push(request)
      if (requests.length <= (options?.failures ?? 0)) throw new Error('provider unavailable')
      return result
    },
    current: null,
    onChange: (next) => published.push(next),
  }
  const adapter = registerEditPredictionAdapter({
    monaco: monaco.api as never,
    editor: editor as never,
    model: model as never,
    language: 'typescript',
    getController: () => controller,
    isReadOnly: () => false,
    isExternalChange: () => false,
  })
  return {
    model,
    editor,
    provider: monaco.provider,
    requests,
    published,
    adapter,
    controller,
  }
}

const ask = (h: Harness, line = 2, column = 1, triggerKind: number = TRIGGER.Automatic) =>
  h
    .provider()
    .provideInlineCompletions(
      h.model,
      { lineNumber: line, column },
      { includeInlineEdits: true, includeInlineCompletions: true, triggerKind },
      LIVE_TOKEN,
    )

// The debounce that actually governs Tab latency lives on the provider, and nothing pinned it:
// deleting `debounceDelayMs` broke no test. Monaco resolves the delay as
// `findLastMax(providers.map(p => p.debounceDelayMs)) ?? recommendedDebounceValue`, so dropping
// ours silently falls back to Monaco's built-in provider — registered as `{ min: 50, max: 50 }`, i.e. a
// constant 50ms, not the adaptive value its sliding-window average suggests. A 6-test
// cadence-adaptive 350-700ms policy used to sit beside this with no caller at all; this is the
// number that runs.
describe('edit-prediction driver — request pacing', () => {
  it('retries transient failures without poisoning the negative cache or blocking typing', async () => {
    const h = harness({ failures: 1, result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    expect((await ask(h)).items).toEqual([])
    expect((await ask(h)).items).toHaveLength(1)
    expect(h.requests).toHaveLength(2)
    expect((await ask(h, 2, 1, TRIGGER.Explicit)).items).toHaveLength(1)
    expect(h.requests).toHaveLength(3)
  })
  it('declares its own debounce rather than inheriting the editor default', () => {
    const h = harness()
    expect(h.provider().debounceDelayMs).toBe(100)
  })
})

describe('edit-prediction driver — asking the model', () => {
  it('renders a caret insertion as ghost text instead of a whole-line diff', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    const result = await ask(h, 2, 12)
    expect(result.items[0].insertText).toBe('0')
    expect(result.items[0].isInlineEdit).toBe(false)
    expect(result.items[0].range.startColumn).toBe(12)
    expect(result.items[0].range.endColumn).toBe(12)
    expect(result.items[0].hint).toBeUndefined()
  })
  it('sends the cursor and the document, and offers the first hunk as an inline edit', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    const result = await ask(h, 2, 5)

    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]).toMatchObject({ cursorLine: 2, cursorColumn: 4, content: FILE })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].insertText).toBe('const b = 20')
    expect(result.items[0].isInlineEdit).toBe(true)
  })

  it('asks once per distinct document+cursor and serves the repeat from cache', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    await ask(h, 2, 1)
    h.adapter.invalidate() // drop the shown bundle, keep the cache
    await ask(h, 2, 1)
    expect(h.requests).toHaveLength(1)
  })

  it('does not ask while an IME composition is in progress', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    h.editor.startComposing()
    expect((await ask(h)).items).toEqual([])
    expect(h.requests).toHaveLength(0)

    h.editor.stopComposing()
    await ask(h)
    expect(h.requests).toHaveLength(1)
  })
})

// The size signals are computed from the inserted text of a content change (`classifyChangeSize`).
// These pin the DRIVER end of that: the flag has to reach eligibility and then be cleared, or one
// large paste would suppress every later prediction.
describe('edit-prediction driver — oversized paste', () => {
  const bigPaste = 'x'.repeat(OVERSIZED_PASTE_CHARS + 1)

  it('suppresses the automatic request that follows a large paste', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    h.model.edit(`${FILE}\n${bigPaste}`, bigPaste)
    expect((await ask(h)).items).toEqual([])
    expect(h.requests).toHaveLength(0)
  })

  it('honours an explicit invoke over the same paste', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    h.model.edit(`${FILE}\n${bigPaste}`, bigPaste)
    await ask(h, 2, 1, TRIGGER.Explicit)
    expect(h.requests).toHaveLength(1)
  })

  // Isolates the flag CLEAR rather than the recompute. A later content change recomputes both
  // signals anyway, so clearing only matters when Monaco asks twice with no edit in between —
  // a cursor move, or an explicit invoke right after the paste was refused.
  it('suppresses only the first request after a paste, not every request until the next edit', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    h.model.edit(`${FILE}\n${bigPaste}`, bigPaste)
    expect((await ask(h)).items).toEqual([])
    expect(h.requests).toHaveLength(0)

    // No edit happened; the caret merely moved.
    await ask(h, 3, 1)
    expect(h.requests).toHaveLength(1)
  })

  it('does not let one large paste suppress the next ordinary keystroke', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    h.model.edit(`${FILE}\n${bigPaste}`, bigPaste)
    await ask(h) // consumes and clears the flag
    h.model.edit(FILE.replace('const b = 2', 'const b = 21'), '1')
    await ask(h)
    expect(h.requests).toHaveLength(1)
  })
})

// Everything below is a staleness guarantee. A prediction is anchored to exact text at an exact
// version; delivering one computed against text the user has since changed is worse than
// delivering nothing, because it looks authoritative.
describe('edit-prediction driver — never deliver a stale result', () => {
  it('discards a result whose request the document has moved past', async () => {
    const model = createFakeModel(FILE)
    const editor = createFakeEditor()
    const monaco = createFakeMonaco()
    const published: Array<EditorSuggestion[] | null> = []
    let release!: (value: EditorSuggestion[] | null) => void
    const controller: NextEditController = {
      source: () => new Promise((resolve) => (release = resolve)),
      current: null,
      onChange: (next) => published.push(next),
    }
    registerEditPredictionAdapter({
      monaco: monaco.api as never,
      editor: editor as never,
      model: model as never,
      language: 'typescript',
      getController: () => controller,
      isReadOnly: () => false,
      isExternalChange: () => false,
    })

    const inflight = monaco
      .provider()
      .provideInlineCompletions(
        model,
        { lineNumber: 2, column: 1 },
        { includeInlineEdits: true, triggerKind: TRIGGER.Automatic },
        LIVE_TOKEN,
      )

    // The user types while the model is still thinking.
    model.edit(FILE.replace('const b = 2', 'const b = 22'), '2')
    release([hunk('h1', 2, 'const b = 2', 'const b = 20')])

    expect((await inflight).items).toEqual([])
    // Nothing was offered, and the host was never told to show it.
    expect(published.filter(Boolean)).toEqual([])
  })

  // Isolates the VERSION guard. A user edit also bumps the request generation, so the generation
  // check alone covers that case; an EXTERNAL change (the host pushing a new value) makes the
  // content handler return early, leaving the generation untouched. Only comparing the document
  // version catches it — which is why both checks exist.
  it('discards a result when an external change moved the document underneath it', async () => {
    const model = createFakeModel(FILE)
    const editor = createFakeEditor()
    const monaco = createFakeMonaco()
    const published: Array<EditorSuggestion[] | null> = []
    let release!: (value: EditorSuggestion[] | null) => void
    const controller: NextEditController = {
      source: () => new Promise((resolve) => (release = resolve)),
      current: null,
      onChange: (next) => published.push(next),
    }
    registerEditPredictionAdapter({
      monaco: monaco.api as never,
      editor: editor as never,
      model: model as never,
      language: 'typescript',
      getController: () => controller,
      isReadOnly: () => false,
      // The host is replacing the buffer, so the content handler bails out early.
      isExternalChange: () => true,
    })

    const inflight = monaco
      .provider()
      .provideInlineCompletions(
        model,
        { lineNumber: 2, column: 1 },
        { includeInlineEdits: true, triggerKind: TRIGGER.Automatic },
        LIVE_TOKEN,
      )

    // The replacement leaves line 2 byte-identical, so the hunk's anchor still validates and
    // the anchor check cannot save us. Only the document version differs.
    model.edit(`${FILE}\nconst d = 4`, 'const d = 4')
    release([hunk('h1', 2, 'const b = 2', 'const b = 20')])

    expect((await inflight).items).toEqual([])
    expect(published.filter(Boolean)).toEqual([])
  })

  it('returns nothing for an already-cancelled token', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    const result = await h
      .provider()
      .provideInlineCompletions(
        h.model,
        { lineNumber: 2, column: 1 },
        { includeInlineEdits: true, triggerKind: TRIGGER.Automatic },
        CANCELLED_TOKEN,
      )
    expect(result.items).toEqual([])
  })

  it('refuses a hunk whose anchor text no longer matches the buffer', async () => {
    // The model answers with the right shape against text that is no longer there.
    const h = harness({ result: [hunk('h1', 2, 'WAS SOMETHING ELSE', 'const b = 20')] })
    expect((await ask(h)).items).toEqual([])
  })

  it('offers nothing once disposed', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 20')] })
    h.adapter.dispose()
    expect((await ask(h)).items).toEqual([])
    expect(h.requests).toHaveLength(0)
  })
})

describe('edit-prediction driver — accepting and rejecting', () => {
  const bundle = [
    hunk('h1', 2, 'const b = 2', 'const b = 20'),
    hunk('h2', 3, 'const c = 3', 'const c = 30'),
  ]

  it('publishes the surviving hunks when the first is accepted', async () => {
    const h = harness({ result: bundle })
    const offered = await ask(h)
    const item = offered.items[0]

    // Monaco applies the edit, then reports the end of life.
    h.model.edit(FILE.replace('const b = 2', 'const b = 20'), 'const b = 20')
    h.published.length = 0
    h.provider().handleEndOfLifetime({}, item, { kind: END_OF_LIFE.Accepted })

    expect(h.published).toHaveLength(1)
    expect(h.published[0]?.map((s) => s.id)).toEqual(['h2'])
  })

  it('clears everything when the offer is rejected', async () => {
    const h = harness({ result: bundle })
    const offered = await ask(h)
    h.published.length = 0
    h.provider().handleEndOfLifetime({}, offered.items[0], { kind: END_OF_LIFE.Rejected })
    expect(h.published).toEqual([null])
    expect((await ask(h)).items).toEqual([])
    expect((await ask(h, 2, 1, TRIGGER.Explicit)).items).toHaveLength(1)
  })

  it('resumes after changing the source without requiring a document edit', async () => {
    const h = harness({ result: bundle })
    const offered = await ask(h)
    h.provider().handleEndOfLifetime({}, offered.items[0], { kind: END_OF_LIFE.Rejected })
    h.controller.source = async () => bundle
    expect((await ask(h)).items).toHaveLength(1)
  })

  it('automatically resumes when the same source is disabled and re-enabled', async () => {
    const h = harness({ result: bundle })
    const offered = await ask(h)
    h.provider().handleEndOfLifetime({}, offered.items[0], { kind: END_OF_LIFE.Rejected })
    const source = h.controller.source
    h.controller.source = undefined
    expect((await ask(h)).items).toEqual([])
    h.controller.source = source
    expect((await ask(h)).items).toHaveLength(1)
  })

  it('an old rejection cannot suppress suggestions for a newer document', async () => {
    const h = harness({ result: bundle })
    const offered = await ask(h)
    h.model.edit(`${FILE}\nconst d = 4`, '4')
    h.provider().handleEndOfLifetime({}, offered.items[0], { kind: END_OF_LIFE.Rejected })
    expect((await ask(h)).items).toHaveLength(1)
  })

  it('an edit OUTSIDE the pending bundle asks again instead of re-offering the old one', async () => {
    // The bundle was predicted for lines 2–3. Deleting text on line 1 is a step it never saw;
    // re-offering it (no new request) is how the suggestion for the new hole never came.
    const h = harness({ result: bundle })
    await ask(h)
    h.model.edit(FILE.replace('const a = 1', 'const a = '), '')
    await ask(h, 1, 11)
    expect(h.requests).toHaveLength(2)
  })

  it('typing INSIDE a pending hunk keeps it without a new request', async () => {
    const h = harness({ result: [hunk('h1', 2, 'const b = 2', 'const b = 2000')] })
    await ask(h)
    h.model.edit(FILE.replace('const b = 2', 'const b = 20'), '0')
    await ask(h, 2, 13)
    expect(h.requests).toHaveLength(1)
  })

  it('manual invocation fetches a fresh answer even with a pending bundle', async () => {
    const h = harness({ result: bundle })
    await ask(h)
    await ask(h, 2, 1, TRIGGER.Explicit)
    expect(h.requests).toHaveLength(2)
  })

  it('ignores an end-of-life report for an offer that is no longer active', async () => {
    const h = harness({ result: bundle })
    const offered = await ask(h)
    h.adapter.invalidate()
    h.published.length = 0
    h.provider().handleEndOfLifetime({}, offered.items[0], { kind: END_OF_LIFE.Rejected })
    expect(h.published).toEqual([])
  })
})

describe('edit-prediction driver — multi-hunk context key', () => {
  it('is set only while more than one hunk is pending', async () => {
    const h = harness({
      result: [
        hunk('h1', 2, 'const b = 2', 'const b = 20'),
        hunk('h2', 3, 'const c = 3', 'const c = 30'),
      ],
    })
    expect(h.editor.contextKeys.get('localixHasMultipleNextEdits')).toBe(false)
    await ask(h)
    expect(h.editor.contextKeys.get('localixHasMultipleNextEdits')).toBe(true)
    h.adapter.invalidate()
    expect(h.editor.contextKeys.get('localixHasMultipleNextEdits')).toBe(false)
  })
})
