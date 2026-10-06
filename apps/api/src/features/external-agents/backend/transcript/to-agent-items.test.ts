import { describe, expect, test } from 'bun:test'
import { toAgentItems, toTranscriptTurns } from './to-agent-items'
import type { TranscriptEvent } from '../../shared/contracts'

const KEY = 'claude-code:5f1c0b9e'

function event(partial: Partial<TranscriptEvent> & { ordinal: number }): TranscriptEvent {
  return {
    provider: 'claude-code',
    nativeSessionId: '5f1c0b9e',
    role: 'assistant',
    text: `text-${partial.ordinal}`,
    ...partial,
  }
}

describe('one assistant turn is not one unbounded message', () => {
  /**
   * A turn ends when the reader speaks, and a coding agent works for a long time without being spoken
   * to. Measured over 32 real sessions at 2000 events: four produced a single message with more than
   * 500 items, the worst held 1,169, and the MEDIAN message held one. The list virtualizes messages,
   * so such a message is one row that mounts its whole run — and the chat's folding cannot help,
   * because it keys on our tool registry and a foreign name falls through to a fallback that is
   * neither read-only nor stackable (1,169 identical `Bash` calls measured as 1,169 groups).
   */
  test('a long assistant run is split into bounded messages, in order and losing nothing', () => {
    const turns = toTranscriptTurns(
      Array.from({ length: 450 }, (_, ordinal) => event({ ordinal, role: 'assistant' })),
      KEY,
    )

    expect(turns).toHaveLength(3)
    expect(turns.map((turn) => turn.items.length)).toEqual([200, 200, 50])
    expect(turns.every((turn) => turn.role === 'assistant')).toBe(true)
    // Nothing reordered and nothing dropped: the split is a rendering decision only.
    const texts = turns.flatMap((turn) => turn.items.map((item) => (item as { text: string }).text))
    expect(texts).toHaveLength(450)
    expect(texts[0]).toBe('text-0')
    expect(texts.at(-1)).toBe('text-449')
  })

  test('an ordinary turn is never split, because the bound sits far above the median', () => {
    const turns = toTranscriptTurns(
      Array.from({ length: 40 }, (_, ordinal) => event({ ordinal, role: 'assistant' })),
      KEY,
    )
    expect(turns).toHaveLength(1)
    expect(turns[0]?.items).toHaveLength(40)
  })

  test('a user event still opens its own turn, whatever the bound', () => {
    // The split must not blur the one boundary that is real data: who was speaking.
    const turns = toTranscriptTurns(
      [
        ...Array.from({ length: 250 }, (_, ordinal) => event({ ordinal, role: 'assistant' })),
        event({ ordinal: 250, role: 'user', text: 'and now the tests' }),
      ],
      KEY,
    )
    expect(turns.map((turn) => turn.role)).toEqual(['assistant', 'assistant', 'user'])
  })
})

describe('a window that opens mid-pair says so', () => {
  /**
   * A tail read keeps the last N events, and that boundary does not respect a call/result pair.
   * Measured across a real local history, roughly half of all tail windows open on a result whose call was
   * evicted: claude-code 21/39, codex 21/50, opencode 13/24, gemini-cli 8/16. It used to render as
   * an ordinary card named `tool` with no IN row — "something ran and we do not know what" instead
   * of "its call is earlier than what you asked for".
   */
  test('a leading result whose call was evicted is named as such', () => {
    const items = toAgentItems(
      [event({ ordinal: 387, role: 'tool', text: '3 files changed' })],
      KEY,
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'tool_call',
      name: 'tool (call precedes this window)',
      resultText: '3 files changed',
    })
    // Still no fabricated IN: the arguments really are outside the window.
    expect((items[0] as { input?: unknown }).input).toBeUndefined()
  })

  test('a window that starts at the session start is not blamed for a missing call', () => {
    // Ordinal 0 proves nothing was evicted, so an unnamed result is just an unnamed result — the
    // guard must not relabel every nameless tool event in a head read.
    const items = toAgentItems([event({ ordinal: 0, role: 'tool', text: 'ok' })], KEY)
    expect(items[0]).toMatchObject({ type: 'tool_call', name: 'tool' })
  })

  test('only the first event can have lost its call', () => {
    // A result deeper in the window either paired with its call or followed one that did not match;
    // either way the window boundary is not the explanation, so it keeps the plain name.
    const items = toAgentItems(
      [
        event({ ordinal: 40, role: 'assistant', text: 'let me look' }),
        event({ ordinal: 41, role: 'tool', text: 'ok' }),
      ],
      KEY,
    )
    expect(items.map((item) => (item as { name?: string }).name)).toEqual([undefined, 'tool'])
  })
})

describe('toAgentItems — narrative', () => {
  test('user and assistant prose become text items carrying the original text', () => {
    const items = toAgentItems(
      [
        event({ ordinal: 0, role: 'user', text: 'fix the flaky test' }),
        event({ ordinal: 1, role: 'assistant', text: 'looking at it now' }),
      ],
      KEY,
    )
    expect(items).toMatchObject([
      { type: 'text', text: 'fix the flaky test', status: 'completed' },
      { type: 'text', text: 'looking at it now', status: 'completed' },
    ])
  })

  test('a system event becomes reasoning, not a message bubble', () => {
    const [item] = toAgentItems(
      [event({ ordinal: 0, role: 'system', text: 'context left: 40%' })],
      KEY,
    )
    expect(item).toMatchObject({ type: 'reasoning', text: 'context left: 40%' })
  })

  test('an empty transcript yields no items', () => {
    expect(toAgentItems([], KEY)).toEqual([])
  })

  test('the provider timestamp lands on startedAt without inventing a duration', () => {
    const [item] = toAgentItems([event({ ordinal: 0, timestamp: 1_700_000_000_000 })], KEY)
    expect(item.startedAt).toBe(1_700_000_000_000)
    expect(item.completedAt).toBeUndefined()
  })
})

describe('toAgentItems — every tool is a generic tool_call', () => {
  // The rule most likely to be "helpfully" broken later: these tool names are the exact ones
  // `classifyTool` maps to our rich cards, and a foreign agent's version of them agrees with our
  // input/output shapes only by coincidence. Foreign transcripts render as generic IN/OUT, always.
  const FOREIGN_TOOLS = ['Bash', 'bash', 'Edit', 'Write', 'apply_patch', 'mcp__linear__issue']

  test('shell, edit and mcp-shaped tool names never reach command/file_change/mcp_call', () => {
    const items = toAgentItems(
      FOREIGN_TOOLS.map((toolName, ordinal) => event({ ordinal, toolName, text: 'ok' })),
      KEY,
    )
    expect(items).toHaveLength(FOREIGN_TOOLS.length)
    for (const item of items) {
      expect(item.type).toBe('tool_call')
      expect(item.type).not.toBe('command')
      expect(item.type).not.toBe('file_change')
      expect(item.type).not.toBe('mcp_call')
    }
    expect(items.map((i) => ('name' in i ? i.name : undefined))).toEqual(FOREIGN_TOOLS)
  })

  test('a tool event renders as OUT with no fabricated IN', () => {
    const [item] = toAgentItems(
      [event({ ordinal: 0, toolName: 'Bash', text: 'src/index.ts\nsrc/app.ts' })],
      KEY,
    )
    expect(item).toMatchObject({
      type: 'tool_call',
      name: 'Bash',
      resultText: 'src/index.ts\nsrc/app.ts',
      activeVerb: 'Running',
    })
    // The adapters flatten arguments into `text`; nothing here may reconstruct an argument object.
    expect('input' in item ? item.input : undefined).toBeUndefined()
  })

  test('a role:tool event without a tool name stays a tool call rather than becoming dialogue', () => {
    const [item] = toAgentItems([event({ ordinal: 0, role: 'tool', text: 'exit 0' })], KEY)
    expect(item).toMatchObject({ type: 'tool_call', name: 'tool', resultText: 'exit 0' })
  })

  test('nothing is marked failed, because the contract never says a call failed', () => {
    const items = toAgentItems(
      [
        event({ ordinal: 0, toolName: 'Bash', text: 'error: ENOENT, command failed' }),
        event({ ordinal: 1, role: 'tool', toolName: 'Read', text: 'Error: no such file' }),
      ],
      KEY,
    )
    expect(items.every((i) => i.status === 'completed')).toBe(true)
  })

  test('touchedFiles never promotes an event into a file_change item', () => {
    const [item] = toAgentItems(
      [event({ ordinal: 0, toolName: 'Edit', text: 'applied', touchedFiles: ['src/a.ts'] })],
      KEY,
    )
    expect(item.type).toBe('tool_call')
  })
})

describe('toAgentItems — call/result pairing', () => {
  test('an adjacent result for the same tool folds into the call it belongs to', () => {
    const items = toAgentItems(
      [
        event({
          ordinal: 0,
          role: 'assistant',
          toolName: 'Bash',
          text: '[tool: Bash]',
          timestamp: 10,
        }),
        event({
          ordinal: 1,
          role: 'tool',
          toolName: 'Bash',
          text: '4 files changed',
          timestamp: 40,
        }),
      ],
      KEY,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'tool_call',
      name: 'Bash',
      resultText: '4 files changed',
      startedAt: 10,
      completedAt: 40,
    })
  })

  test('an id pairs across a gap, because an id needs no adjacency', () => {
    /**
     * The case parallel tool use actually produces: two calls issued, then both results, in the
     * reverse order. Requiring the result to be the NEXT event made the id useless exactly where it
     * was needed. Measured on a real local history when it did: Copilot folded 62% of 5,501 tool cards and
     * left 2,054 with no call attached, while the four providers whose results happen to arrive
     * adjacent folded 100% — so the rule read as a general design and was a bet on one event order.
     */
    const items = toAgentItems(
      [
        event({ ordinal: 0, role: 'assistant', toolName: 'grep', toolCallId: 'call_A' }),
        event({ ordinal: 1, role: 'assistant', toolName: 'view', toolCallId: 'call_B' }),
        event({ ordinal: 2, role: 'tool', toolCallId: 'call_B', text: 'B output' }),
        event({ ordinal: 3, role: 'tool', toolCallId: 'call_A', text: 'A output' }),
      ],
      KEY,
    )

    // Two cards, not four, and neither result standing alone.
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ type: 'tool_call', name: 'grep', resultText: 'A output' })
    expect(items[1]).toMatchObject({ type: 'tool_call', name: 'view', resultText: 'B output' })
  })

  test('a result whose id matches no call still stands alone', () => {
    const items = toAgentItems(
      [
        event({ ordinal: 0, role: 'assistant', toolName: 'grep', toolCallId: 'call_A' }),
        event({ ordinal: 1, role: 'tool', toolCallId: 'call_ELSEWHERE', text: 'not ours' }),
      ],
      KEY,
    )

    // Pairing on proximity alone would have attached this; the id says it belongs to another call.
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ name: 'grep' })
    // `resultText` is NOT the signal: an unpaired call keeps its own text there by design. A folded
    // pair is the only thing that sets `completedAt`, so that is what "paired" means.
    expect(items[0]?.completedAt).toBeUndefined()
  })

  test('a result BEFORE its call is not claimed by it', () => {
    // Same id appearing earlier belongs to an earlier call we cannot see. Searching the whole
    // session by id must not reach backwards.
    const items = toAgentItems(
      [
        event({ ordinal: 0, role: 'tool', toolCallId: 'call_A', text: 'earlier output' }),
        event({ ordinal: 1, role: 'assistant', toolName: 'grep', toolCallId: 'call_A' }),
      ],
      KEY,
    )

    expect(items).toHaveLength(2)
    expect(items[1]?.completedAt).toBeUndefined()
  })

  test('two calls to the same tool before either returns stay separate rather than mispairing', () => {
    const items = toAgentItems(
      [
        event({ ordinal: 0, role: 'assistant', toolName: 'Read', text: '[tool: Read]' }),
        event({ ordinal: 1, role: 'assistant', toolName: 'Read', text: '[tool: Read]' }),
        event({ ordinal: 2, role: 'tool', toolName: 'Read', text: 'contents of b' }),
      ],
      KEY,
    )
    // The first call keeps no result — attaching the only result to it would be a guess.
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ resultText: '[tool: Read]' })
    expect(items[1]).toMatchObject({ resultText: 'contents of b' })
  })

  test('a result naming a different tool is its own item', () => {
    const items = toAgentItems(
      [
        event({ ordinal: 0, role: 'assistant', toolName: 'Bash', text: '[tool: Bash]' }),
        event({ ordinal: 1, role: 'tool', toolName: 'Read', text: 'contents' }),
      ],
      KEY,
    )
    expect(items).toHaveLength(2)
    expect(items.map((i) => ('name' in i ? i.name : undefined))).toEqual(['Bash', 'Read'])
  })
})

describe('toAgentItems — ids and ordering', () => {
  const events = [
    event({ ordinal: 0, role: 'user', text: 'go' }),
    event({ ordinal: 1, toolName: 'Bash', text: 'ok' }),
    event({ ordinal: 2, role: 'assistant', text: 'done' }),
  ]

  test('ids are unique and repeat exactly across two calls with the same input', () => {
    const first = toAgentItems(events, KEY)
    const second = toAgentItems(events, KEY)
    expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id))
    expect(new Set(first.map((i) => i.id)).size).toBe(first.length)
  })

  test('an id is derived from the session key and ordinal, so a narrower re-read is stable', () => {
    const full = toAgentItems(events, KEY)
    // A second read with a smaller `maxEvents` window drops the head, not the ids.
    const windowed = toAgentItems(events.slice(1), KEY)
    expect(windowed.map((i) => i.id)).toEqual(full.slice(1).map((i) => i.id))
    expect(full[1].id).toBe(`${KEY}#1`)
  })

  test('two sessions sharing an ordinal do not collide', () => {
    const a = toAgentItems([event({ ordinal: 0 })], 'claude-code:one')
    const b = toAgentItems([event({ ordinal: 0 })], 'codex:two')
    expect(a[0].id).not.toBe(b[0].id)
  })

  test('a duplicated ordinal is disambiguated rather than merging two cards', () => {
    const items = toAgentItems(
      [event({ ordinal: 3, text: 'first' }), event({ ordinal: 3, text: 'second' })],
      KEY,
    )
    expect(new Set(items.map((i) => i.id)).size).toBe(2)
  })

  test('order follows ordinal, not timestamp or array position', () => {
    const items = toAgentItems(
      [
        event({ ordinal: 2, text: 'third', timestamp: 1 }),
        event({ ordinal: 0, text: 'first', timestamp: 9_999 }),
        event({ ordinal: 1, text: 'second', timestamp: 500 }),
      ],
      KEY,
    )
    expect(items.map((i) => ('text' in i ? i.text : undefined))).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  test('a tool item reuses its item id as the toolCallId', () => {
    const [item] = toAgentItems([event({ ordinal: 7, toolName: 'Bash', text: 'ok' })], KEY)
    expect(item).toMatchObject({ id: `${KEY}#7`, toolCallId: `${KEY}#7` })
  })
})
