/**
 * Per-request wire-level elision (the in-turn context bound). Guards: old recoverable
 * read results + write args are elided beyond the recent window, the recent tail and
 * bash output are kept, tool_call ids are preserved, and the pass is idempotent.
 */
import { describe, it, expect } from 'bun:test'
import type { Message, ToolResult } from '../types'
import { pruneWireMessages, collectElidedToolCallIds } from './prune-wire'

/** The text of a tool-result `content` (a string, or a content-block array). */
const contentText = (content: ToolResult['content'] | undefined): string =>
  typeof content === 'string'
    ? content
    : (content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('')

const big = (label: string) =>
  Array.from({ length: 200 }, (_, i) => `${label} line ${i}`).join('\n')

function buildWire(reads: number): Message[] {
  const msgs: Message[] = [{ role: 'user', content: 'Build it.', timestamp: 0 }]
  // One assistant turn that fires `reads` read tool calls...
  const calls = Array.from({ length: reads }, (_, i) => ({
    type: 'tool_call' as const,
    id: `r${i}`,
    name: 'Read',
    arguments: { path: `src/f${i}.ts` },
  }))
  msgs.push({
    role: 'assistant',
    content: [{ type: 'text', text: 'reading' }, ...calls],
    model: 'm',
    timestamp: 0,
  })
  // ...and the accumulating tool result messages (the in-turn balloon).
  for (let i = 0; i < reads; i++) {
    msgs.push({
      role: 'tool',
      results: [
        { type: 'tool_result', toolCallId: `r${i}`, toolName: 'Read', content: big(`f${i}`) },
      ],
      timestamp: 0,
    })
  }
  // a bash result (non-recoverable) and a write, near the end
  msgs.push({
    role: 'assistant',
    content: [
      { type: 'tool_call', id: 'b1', name: 'Bash', arguments: { command: 'npm test' } },
      {
        type: 'tool_call',
        id: 'w1',
        name: 'Write',
        arguments: { path: 'src/x.ts', content: big('xfile') },
      },
    ],
    model: 'm',
    timestamp: 0,
  })
  msgs.push({
    role: 'tool',
    results: [{ type: 'tool_result', toolCallId: 'b1', toolName: 'Bash', content: big('bashout') }],
    timestamp: 0,
  })
  msgs.push({
    role: 'tool',
    results: [
      { type: 'tool_result', toolCallId: 'w1', toolName: 'Write', content: 'Wrote src/x.ts' },
    ],
    timestamp: 0,
  })
  return msgs
}

const tok = (x: unknown) => Math.ceil(JSON.stringify(x).length / 4)

describe('pruneWireMessages (per-request in-turn bound)', () => {
  const wire = buildWire(30)
  const before = tok(wire)
  const out = pruneWireMessages(wire, { keepRecentTokens: 8000 })
  const after = tok(out)

  it('bounds a tool-heavy turn well below the raw size', () => {
    expect(before).toBeGreaterThan(18_000)
    // 0.7 (not 0.6): boundary quantization deliberately protects up to Q−1 extra
    // messages so the elided prefix stays prompt-cache stable across requests.
    expect(after).toBeLessThan(before * 0.7)
  })

  it('elides OLD recoverable read results to a re-readable pointer', () => {
    const firstToolMsg = out.find((m) => m.role === 'tool') as Extract<Message, { role: 'tool' }>
    expect(firstToolMsg.results[0].content).toContain('elided to save context')
  })

  it('keeps bash output (non-recoverable) intact', () => {
    const bashResult = out
      .filter((m): m is Extract<Message, { role: 'tool' }> => m.role === 'tool')
      .flatMap((m) => m.results)
      .find((r) => r.toolName === 'Bash')
    expect(bashResult?.content).toBe(big('bashout'))
  })

  it('preserves all tool_call ids (pairing safe)', () => {
    const ids = (ms: Message[]) =>
      ms
        .flatMap((m) =>
          m.role === 'assistant'
            ? m.content
                .filter(
                  (p): p is Extract<typeof p, { type: 'tool_call' }> =>
                    (p as { type?: string }).type === 'tool_call',
                )
                .map((p) => p.id)
            : m.role === 'tool'
              ? m.results.map((r) => r.toolCallId)
              : [],
        )
        .sort()
    expect(ids(out)).toEqual(ids(wire))
  })

  it('is idempotent', () => {
    const after2 = tok(pruneWireMessages(out, { keepRecentTokens: 8000 }))
    expect(after2).toBe(after)
  })

  it('returns the same reference when nothing is elidable', () => {
    const tiny: Message[] = [{ role: 'user', content: 'hi', timestamp: 0 }]
    expect(pruneWireMessages(tiny)).toBe(tiny)
  })
})

describe('pruneWireMessages — quality guards', () => {
  const filler: Message[] = Array.from({ length: 8 }, (_, i) => ({
    role: 'user' as const,
    content: `follow-up ${big(`pad${i}`)}`,
    timestamp: 0,
  }))

  it('elides BOTH old_string and new_string of an old edit call (every heavy field, not just the first)', () => {
    const wire: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            id: 'e1',
            name: 'Edit',
            arguments: { path: 'src/a.ts', old_string: big('old'), new_string: big('new') },
          },
        ],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [
          { type: 'tool_result', toolCallId: 'e1', toolName: 'Edit', content: 'Applied 1 edit' },
        ],
        timestamp: 0,
      },
      ...filler,
    ]
    const out = pruneWireMessages(wire, { keepRecentTokens: 1000, minKeepRecent: 2 })
    const call = (out[1] as Extract<Message, { role: 'assistant' }>).content[0] as {
      arguments: Record<string, string>
    }
    expect(call.arguments.old_string).toContain('elided to save context')
    expect(call.arguments.new_string).toContain('elided to save context')
    expect(call.arguments.path).toBe('src/a.ts')
  })

  it('head/tail bounds a huge OLD bash heredoc command arg (was never bounded before)', () => {
    const heredoc = `cat > /tmp/test.mjs <<'EOF'\n${big('codeA')}\n${big('codeB')}\nEOF` // > 4.5KB
    const wire: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            id: 'b1',
            name: 'Bash',
            arguments: { command: heredoc, description: 'write test' },
          },
        ],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [{ type: 'tool_result', toolCallId: 'b1', toolName: 'Bash', content: 'ok' }],
        timestamp: 0,
      },
      ...filler,
    ]
    const out = pruneWireMessages(wire, { keepRecentTokens: 1000, minKeepRecent: 2 })
    const callPart = (out[1] as Extract<Message, { role: 'assistant' }>).content[0]
    const call = callPart as { arguments: Record<string, string> }
    expect(call.arguments.command).toContain('middle truncated to save context')
    expect(call.arguments.command.length).toBeLessThan(heredoc.length)
    expect(call.arguments.command).toContain('cat > /tmp/test.mjs') // command head survives
    expect(call.arguments.description).toBe('write test') // other args untouched
    // Idempotent: a second pass doesn't re-bound.
    const twice = pruneWireMessages(out, { keepRecentTokens: 1000, minKeepRecent: 2 })
    expect((twice[1] as Extract<Message, { role: 'assistant' }>).content[0]).toBe(callPart)
  })

  it('leaves a small bash command untouched', () => {
    const wire: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'b1', name: 'Bash', arguments: { command: 'npm run build' } },
        ],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [{ type: 'tool_result', toolCallId: 'b1', toolName: 'Bash', content: 'ok' }],
        timestamp: 0,
      },
      ...filler,
    ]
    const out = pruneWireMessages(wire, { keepRecentTokens: 1000, minKeepRecent: 2 })
    const call = (out[1] as Extract<Message, { role: 'assistant' }>).content[0] as {
      arguments: Record<string, string>
    }
    expect(call.arguments.command).toBe('npm run build')
  })

  it('never elides an errored read result (failures stay visible)', () => {
    const wire: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'r1',
            toolName: 'Read',
            content: big('err'),
            isError: true,
          },
        ],
        timestamp: 0,
      },
      ...filler,
    ]
    const out = pruneWireMessages(wire, { keepRecentTokens: 1000, minKeepRecent: 2 })
    const result = (out[1] as Extract<Message, { role: 'tool' }>).results[0]
    expect(result.content).toBe(big('err'))
  })
})

describe('pruneWireMessages — large OLD non-recoverable output is head+tail bounded', () => {
  const huge = 'HEAD_MARK ' + 'x'.repeat(9000) + ' TAIL_MARK' // >4500 chars, can't re-read
  const filler: Message[] = Array.from({ length: 8 }, (_, i) => ({
    role: 'user' as const,
    content: `pad ${big(`p${i}`)}`,
    timestamp: 0,
  }))
  const wire: Message[] = [
    { role: 'user', content: 'go', timestamp: 0 },
    {
      role: 'assistant',
      content: [{ type: 'tool_call', id: 'b1', name: 'Bash', arguments: { command: 'bun test' } }],
      model: 'm',
      timestamp: 0,
    },
    {
      role: 'tool',
      results: [{ type: 'tool_result', toolCallId: 'b1', toolName: 'Bash', content: huge }],
      timestamp: 0,
    },
    ...filler,
  ]
  const out = pruneWireMessages(wire, { keepRecentTokens: 1000, minKeepRecent: 2 })
  const result = (out[2] as Extract<Message, { role: 'tool' }>).results[0]

  it('keeps the head AND the tail (command start + error/result summary survive)', () => {
    expect(result.content).toContain('HEAD_MARK')
    expect(result.content).toContain('TAIL_MARK')
    expect(result.content).toContain('middle truncated to save context')
    expect(result.content.length).toBeLessThan(huge.length)
  })

  it('leaves a genuinely small bash output untouched (below CRUSH_MIN_CHARS)', () => {
    const tiny = '$ ls\nfile1.ts\nfile2.ts\ndone' // < 1000 chars, not worth bounding
    const small: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'b2', name: 'Bash', arguments: { command: 'ls' } }],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [{ type: 'tool_result', toolCallId: 'b2', toolName: 'Bash', content: tiny }],
        timestamp: 0,
      },
      ...filler,
    ]
    const o = pruneWireMessages(small, { keepRecentTokens: 1000, minKeepRecent: 2 })
    expect((o[2] as Extract<Message, { role: 'tool' }>).results[0].content).toBe(tiny)
  })

  it('structurally crushes a mid-size (1000–4500 char) repetitive bash output (reversible via locator)', () => {
    const mid: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'b3', name: 'Bash', arguments: { command: 'log' } }],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [
          { type: 'tool_result', toolCallId: 'b3', toolName: 'Bash', content: big('noise') },
        ],
        timestamp: 0,
      },
      ...filler,
    ]
    const o = pruneWireMessages(mid, { keepRecentTokens: 1000, minKeepRecent: 2 })
    const content = (o[2] as Extract<Message, { role: 'tool' }>).results[0].content
    expect(content).toContain('crushed to save context')
    expect(content).toContain('ToolOutput(action="get", tool_call_id="b3")') // reversibility locator
    expect(content.length).toBeLessThan(big('noise').length)
  })

  it('is idempotent (already-truncated content is not re-truncated)', () => {
    const out2 = pruneWireMessages(out, { keepRecentTokens: 1000, minKeepRecent: 2 })
    expect((out2[2] as Extract<Message, { role: 'tool' }>).results[0].content).toBe(result.content)
  })
})

describe('pruneWireMessages — boundary quantization (prompt-cache friendly)', () => {
  // Uniform elidable tool messages after a user opener. With keepRecentTokens: 0
  // the protected tail is exactly minKeepRecent messages, so the UN-quantized
  // boundary start would be N − minKeepRecent — sliding by one per new message
  // and breaking the prompt-cache prefix on every request.
  const toolMsg = (i: number): Message => ({
    role: 'tool',
    results: [
      { type: 'tool_result', toolCallId: `r${i}`, toolName: 'Read', content: big(`f${i}`) },
    ],
    timestamp: 0,
  })
  const history = (tools: number): Message[] => [
    { role: 'user', content: 'go', timestamp: 0 },
    ...Array.from({ length: tools }, (_, i) => toolMsg(i)),
  ]
  // default boundaryQuantum (8) deliberately exercised
  const OPTS = { keepRecentTokens: 0, minKeepRecent: 4 } as const
  const prunedIndices = (msgs: Message[], opts: Parameters<typeof pruneWireMessages>[1] = OPTS) => {
    const out = pruneWireMessages(msgs, opts)
    return msgs.map((m, i) => (out[i] !== m ? i : -1)).filter((i) => i >= 0)
  }

  // 20 messages total → un-quantized boundary start = 16, already a multiple of 8
  const base = prunedIndices(history(19))

  it('elides everything before the quantized boundary at the base length', () => {
    expect(base).toEqual(Array.from({ length: 15 }, (_, i) => i + 1)) // 1..15
  })

  it('keeps the pruned prefix IDENTICAL across +1..+(Q−1) new messages', () => {
    for (let k = 1; k < 8; k++) expect(prunedIndices(history(19 + k))).toEqual(base)
  })

  it('jumps the boundary exactly at the next multiple of Q', () => {
    expect(prunedIndices(history(19 + 8))).toEqual(Array.from({ length: 23 }, (_, i) => i + 1)) // 1..23
  })

  it('never moves the boundary backward as the history grows', () => {
    let prevFrontier = -1
    for (let tools = 19; tools <= 40; tools++) {
      const idx = prunedIndices(history(tools))
      const frontier = idx.length ? Math.max(...idx) : -1
      expect(frontier).toBeGreaterThanOrEqual(prevFrontier)
      prevFrontier = frontier
    }
  })

  it('never protects fewer messages than the un-quantized window (tail always intact)', () => {
    for (let tools = 19; tools <= 35; tools++) {
      const msgs = history(tools)
      const out = pruneWireMessages(msgs, OPTS)
      for (let i = msgs.length - 4; i < msgs.length; i++) expect(out[i]).toBe(msgs[i])
    }
  })

  it('boundaryQuantum: 1 disables quantization (boundary slides by one again)', () => {
    // 21 messages → boundary start 17 → indices 1..16 pruned
    expect(prunedIndices(history(20), { ...OPTS, boundaryQuantum: 1 })).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    )
  })
})

describe('pruneWireMessages failed-mutation args', () => {
  it('keeps the content/patch args of a FAILED write verbatim (not on disk — not recoverable)', () => {
    const failedContent = big('failedfile')
    const okContent = big('okfile')
    const msgs: Message[] = [
      { role: 'user', content: 'Build it.', timestamp: 0 },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            id: 'wfail',
            name: 'Write',
            arguments: { path: 'src/a.ts', content: failedContent },
          },
          {
            type: 'tool_call',
            id: 'wok',
            name: 'Write',
            arguments: { path: 'src/b.ts', content: okContent },
          },
        ],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'wfail',
            toolName: 'Write',
            content: 'EACCES: permission denied',
            isError: true,
          },
        ],
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [
          { type: 'tool_result', toolCallId: 'wok', toolName: 'Write', content: 'Wrote src/b.ts' },
        ],
        timestamp: 0,
      },
      // Padding so the writes fall OUTSIDE the protected recent window.
      ...Array.from({ length: 12 }, (_, i): Message => ({
        role: 'tool',
        results: [
          { type: 'tool_result', toolCallId: `p${i}`, toolName: 'Read', content: big(`pad${i}`) },
        ],
        timestamp: 0,
      })),
    ]
    const out = pruneWireMessages(msgs, {
      keepRecentTokens: 100,
      minKeepRecent: 1,
      boundaryQuantum: 1,
    })
    const calls = (out[1] as Extract<Message, { role: 'assistant' }>).content.filter(
      (p): p is Extract<typeof p, { type: 'tool_call' }> =>
        (p as { type?: string }).type === 'tool_call',
    )
    const failArgs = calls.find((c) => c.id === 'wfail')?.arguments as Record<string, unknown>
    const okArgs = calls.find((c) => c.id === 'wok')?.arguments as Record<string, unknown>
    expect(failArgs.content).toBe(failedContent) // kept verbatim
    expect(String(okArgs.content)).toContain('elided to save context') // successful write elided
  })
})

describe('pruneWireMessages — recovery pointer + pressure floor (endless-review fix)', () => {
  it('elided read points at ToolOutput action="get" — NOT a bare "re-read" (the loop)', () => {
    const wire = buildWire(30)
    const out = pruneWireMessages(wire, { keepRecentTokens: 8000 })
    const firstRead = out
      .filter((m): m is Extract<Message, { role: 'tool' }> => m.role === 'tool')
      .flatMap((m) => m.results)
      .find((r) => r.toolName === 'Read' && contentText(r.content).includes('elided'))
    // Must carry a WORKING recovery handle (cheap one-turn replay), not just "re-read".
    expect(firstRead?.content).toContain('ToolOutput(action="get", tool_call_id="r0")')
  })

  it('elided write/edit arg also carries a ToolOutput handle', () => {
    const filler: Message[] = Array.from({ length: 8 }, (_, i) => ({
      role: 'user',
      content: `f ${big(`pad${i}`)}`,
      timestamp: 0,
    }))
    const wire: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            id: 'w7',
            name: 'Write',
            arguments: { path: 'src/a.ts', content: big('body') },
          },
        ],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [
          { type: 'tool_result', toolCallId: 'w7', toolName: 'Write', content: 'Wrote src/a.ts' },
        ],
        timestamp: 0,
      },
      ...filler,
    ]
    const out = pruneWireMessages(wire, { keepRecentTokens: 1000, minKeepRecent: 2 })
    const call = (out[1] as Extract<Message, { role: 'assistant' }>).content[0] as {
      arguments: Record<string, string>
    }
    expect(call.arguments.content).toContain('ToolOutput(action="get", tool_call_id="w7")')
  })

  it('keeps compression truthful when ToolOutput is disabled', () => {
    const out = pruneWireMessages(buildWire(30), {
      keepRecentTokens: 8000,
      recoveryToolAvailable: false,
    })
    const serialized = JSON.stringify(out)
    expect(serialized).toContain('elided to save context')
    expect(serialized).not.toContain('ToolOutput')
    expect(serialized).toContain('re-read the file/source if needed')
  })

  it('pressure floor: below minReclaimTokens the whole history is sent UNCHANGED (no crushing, no pointers)', () => {
    // The exact over-eager case: an unlocked/crushable region smaller than the floor
    // used to crush reads the model still needed → re-read loop. With the floor set
    // above the region, the history passes through verbatim.
    const wire = buildWire(30)
    const unchanged = pruneWireMessages(wire, {
      keepRecentTokens: 8000,
      minReclaimTokens: 1_000_000,
    })
    expect(unchanged).toBe(wire) // same reference — nothing touched
    // With the floor off (default), the same input DOES crush.
    const crushed = pruneWireMessages(wire, { keepRecentTokens: 8000 })
    const anyElided = crushed
      .filter((m): m is Extract<Message, { role: 'tool' }> => m.role === 'tool')
      .flatMap((m) => m.results)
      .some((r) => contentText(r.content).includes('elided'))
    expect(anyElided).toBe(true)
  })

  it('pressure floor does NOT block crushing once the crushable region clears it', () => {
    const wire = buildWire(30) // large — well above an 8k floor
    const out = pruneWireMessages(wire, { keepRecentTokens: 8000, minReclaimTokens: 8192 })
    expect(out).not.toBe(wire)
    expect(tok(out)).toBeLessThan(tok(wire) * 0.7)
  })

  it('pressure gate: a request that still fits the window is sent UNCHANGED', () => {
    // `minReclaimTokens` only sizes the crushable REGION, so a big-window model with
    // ample headroom still got its old reads pointer-elided — and spent turns
    // recovering them. The gate measures the WHOLE request against the window.
    const wire = buildWire(30)
    const total = tok(wire)
    const gated = pruneWireMessages(wire, {
      keepRecentTokens: 8000,
      minReclaimTokens: 8192,
      pressureTokens: total * 10,
    })
    expect(gated).toBe(wire) // same reference — nothing touched

    // Once the request crosses the gate, the existing floor + crushing apply as before.
    const crushed = pruneWireMessages(wire, {
      keepRecentTokens: 8000,
      minReclaimTokens: 8192,
      pressureTokens: 1,
    })
    expect(crushed).not.toBe(wire)
    expect(tok(crushed)).toBeLessThan(total * 0.7)
  })
})

describe('collectElidedToolCallIds', () => {
  it('reports the tool_call_ids whose results the wire no longer carries intact', () => {
    const wire = buildWire(30)
    expect(collectElidedToolCallIds(wire)).toHaveLength(0) // nothing compressed yet

    const pruned = pruneWireMessages(wire, { keepRecentTokens: 8000 })
    const ids = collectElidedToolCallIds(pruned)
    expect(ids.length).toBeGreaterThan(0)

    // Every reported id really belongs to a compressed result, and the protected
    // tail's ids are absent (their results are still verbatim).
    const compressed = new Set(
      pruned
        .filter((m): m is Extract<Message, { role: 'tool' }> => m.role === 'tool')
        .flatMap((m) => m.results)
        .filter((r) => /elided|truncated|crushed/.test(contentText(r.content)))
        .map((r) => r.toolCallId),
    )
    for (const id of ids) expect(compressed.has(id)).toBe(true)
  })

  it('sees markers already present in the input (the turn-start VBC pass)', () => {
    // VBC elides BEFORE convertToLlm, so its markers arrive in the input and
    // pruneWireMessages may return the same array. The scan must still find them.
    const wire: Message[] = [
      { role: 'user', content: 'go' } as Message,
      {
        role: 'tool',
        results: [
          {
            toolCallId: 'v1',
            toolName: 'Read',
            content: '[output elided to save context — 900 chars]',
          },
        ],
      } as Message,
    ]
    expect(collectElidedToolCallIds(wire)).toEqual(['v1'])
  })
})

/**
 * The last un-superseded read of a file is the model's ONLY copy of it. Measured on
 * the recorded corpus: of the reads this layer elided under an `apply_patch` that
 * then failed with "context not found", all but one were still that live copy —
 * the model had to re-read (a wasted turn) or patch from memory (a wrong edit).
 */
describe('pruneWireMessages — live-read protection', () => {
  const body = (label: string) =>
    Array.from({ length: 60 }, (_, i) => `${label} line ${i}`).join('\n')

  const wire = (
    calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
    results: Array<{ id: string; name: string; content: string }>,
  ): Message[] => {
    const msgs: Message[] = [{ role: 'user', content: 'go', timestamp: 0 }]
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i]
      msgs.push({
        role: 'assistant',
        content: [{ type: 'tool_call', id: c.id, name: c.name, arguments: c.args }],
        model: 'm',
        timestamp: 0,
      })
      const r = results.find((x) => x.id === c.id)
      if (r)
        msgs.push({
          role: 'tool',
          results: [
            { type: 'tool_result', toolCallId: r.id, toolName: r.name, content: r.content },
          ],
          timestamp: 0,
        })
    }
    // Push the reads well out of the protected tail (quantization protects up to Q-1 extra).
    for (let i = 0; i < 60; i++)
      msgs.push({ role: 'user', content: `filler ${i} ${'.'.repeat(60)}`, timestamp: 0 })
    return msgs
  }

  const OPTS = { keepRecentTokens: 200, boundaryQuantum: 1 } as const
  const elidedIds = (msgs: Message[]) =>
    new Set(collectElidedToolCallIds(pruneWireMessages(msgs, OPTS)))

  it('keeps the last read of a file and elides an earlier read of the same file', () => {
    const msgs = wire(
      [
        { id: 'a', name: 'Read', args: { path: 'src/a.ts' } },
        { id: 'b', name: 'Read', args: { path: 'src/a.ts' } },
      ],
      [
        { id: 'a', name: 'Read', content: body('old') },
        { id: 'b', name: 'Read', content: body('new') },
      ],
    )
    const elided = elidedIds(msgs)
    expect(elided.has('a')).toBe(true)
    expect(elided.has('b')).toBe(false)
  })

  it('elides a read the model has since superseded by writing the file', () => {
    // Its bytes are stale; apply_patch's post-edit echo carries the current state.
    const msgs = wire(
      [
        { id: 'a', name: 'Read', args: { path: 'src/a.ts' } },
        { id: 'w', name: 'Write', args: { path: 'src/a.ts', content: 'x' } },
      ],
      [
        { id: 'a', name: 'Read', content: body('old') },
        { id: 'w', name: 'Write', content: 'Wrote src/a.ts' },
      ],
    )
    expect(elidedIds(msgs).has('a')).toBe(true)
  })

  it('a FAILED write does not supersede — nothing reached disk, the read stays protected', () => {
    // read → write errors ("permission denied" / patch context not found). The read is
    // still the model's only copy; marking it stale ("the file has CHANGED — do NOT
    // replay") would be factually false and force a wasted re-read on retry.
    const msgs = wire(
      [
        { id: 'a', name: 'Read', args: { path: 'src/a.ts' } },
        { id: 'w', name: 'Write', args: { path: 'src/a.ts', content: 'x' } },
      ],
      [{ id: 'a', name: 'Read', content: body('old') }],
    )
    // attach the FAILED result for the write
    msgs.splice(
      msgs.findIndex(
        (m) => m.role === 'assistant' && (m.content as Array<{ id?: string }>)[0]?.id === 'w',
      ) + 1,
      0,
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'w',
            toolName: 'Write',
            content: 'EACCES: permission denied',
            isError: true,
          },
        ],
        timestamp: 0,
      },
    )
    const pruned = pruneWireMessages(msgs, OPTS)
    const readResult = pruned
      .filter((m) => m.role === 'tool')
      .flatMap((m) => (m as { results: Array<{ toolCallId?: string; content?: unknown }> }).results)
      .find((r) => r.toolCallId === 'a')
    expect(String(readResult?.content)).toBe(body('old')) // live-read protected, verbatim
  })

  it('an apply_patch of the file supersedes the read, via the patch body headers', () => {
    const msgs = wire(
      [
        { id: 'a', name: 'Read', args: { path: 'src/a.ts' } },
        {
          id: 'p',
          name: 'apply_patch',
          args: { patch: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** End Patch' },
        },
      ],
      [
        { id: 'a', name: 'Read', content: body('old') },
        { id: 'p', name: 'apply_patch', content: 'Applied 1 of 1 files' },
      ],
    )
    expect(elidedIds(msgs).has('a')).toBe(true)
  })

  it('a short re-read of a few lines does not supersede the full read', () => {
    // A few lines cannot stand in for the whole file — treating them as an observation
    // would elide the only full copy the model is working from.
    const msgs = wire(
      [
        { id: 'a', name: 'Read', args: { path: 'src/a.ts' } },
        { id: 'lines', name: 'Read', args: { path: 'src/a.ts', start_line: 12, end_line: 13 } },
      ],
      [
        { id: 'a', name: 'Read', content: body('full') },
        { id: 'lines', name: 'Read', content: '12: const a = 1\n13: const b = 2' },
      ],
    )
    expect(elidedIds(msgs).has('a')).toBe(false)
  })

  it('protects only the most recent maxLiveReads files', () => {
    const paths = ['a', 'b', 'c']
    const msgs = wire(
      paths.map((p) => ({ id: p, name: 'Read', args: { path: `src/${p}.ts` } })),
      paths.map((p) => ({ id: p, name: 'Read', content: body(p) })),
    )
    const elided = new Set(
      collectElidedToolCallIds(
        pruneWireMessages(msgs, { ...OPTS, maxLiveReads: 2, liveReadBudgetBytes: 100_000 }),
      ),
    )
    expect(elided.has('a')).toBe(true) // oldest live read loses
    expect(elided.has('b')).toBe(false)
    expect(elided.has('c')).toBe(false)
  })

  it('a live read too large for the budget is elided anyway', () => {
    const msgs = wire(
      [{ id: 'a', name: 'Read', args: { path: 'src/a.ts' } }],
      [{ id: 'a', name: 'Read', content: body('huge') }],
    )
    expect(
      new Set(
        collectElidedToolCallIds(pruneWireMessages(msgs, { ...OPTS, liveReadBudgetBytes: 10 })),
      ).has('a'),
    ).toBe(true)
  })

  it('maxLiveReads: 0 restores blind positional eliding', () => {
    const msgs = wire(
      [{ id: 'a', name: 'Read', args: { path: 'src/a.ts' } }],
      [{ id: 'a', name: 'Read', content: body('only') }],
    )
    expect(
      new Set(collectElidedToolCallIds(pruneWireMessages(msgs, { ...OPTS, maxLiveReads: 0 }))).has(
        'a',
      ),
    ).toBe(true)
  })

  it('stays idempotent: a second pass changes nothing', () => {
    const msgs = wire(
      [
        { id: 'a', name: 'Read', args: { path: 'src/a.ts' } },
        { id: 'b', name: 'Read', args: { path: 'src/b.ts' } },
      ],
      [
        { id: 'a', name: 'Read', content: body('a') },
        { id: 'b', name: 'Read', content: body('b') },
      ],
    )
    const once = pruneWireMessages(msgs, { ...OPTS, maxLiveReads: 1 })
    const twice = pruneWireMessages(once, { ...OPTS, maxLiveReads: 1 })
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })
})

/**
 * An elided read must advertise the recovery that is actually TRUE for it.
 * `ToolOutput` replays the bytes verbatim — correct for a read nothing has
 * touched, wrong for one whose file has since changed (it would hand the model
 * content that no longer exists on disk), and pointless for one the model already
 * re-read further down the conversation.
 */
describe('pruneWireMessages — an elided read gets the pointer that is true for it', () => {
  const body = (label: string) =>
    Array.from({ length: 60 }, (_, i) => `${label} line ${i}`).join('\n')

  const wire = (
    calls: Array<{ id: string; name: string; args: Record<string, unknown>; content: string }>,
  ): Message[] => {
    const msgs: Message[] = [{ role: 'user', content: 'go', timestamp: 0 }]
    for (const c of calls) {
      msgs.push({
        role: 'assistant',
        content: [{ type: 'tool_call', id: c.id, name: c.name, arguments: c.args }],
        model: 'm',
        timestamp: 0,
      })
      msgs.push({
        role: 'tool',
        results: [{ type: 'tool_result', toolCallId: c.id, toolName: c.name, content: c.content }],
        timestamp: 0,
      })
    }
    for (let i = 0; i < 60; i++)
      msgs.push({ role: 'user', content: `filler ${i} ${'.'.repeat(60)}`, timestamp: 0 })
    return msgs
  }
  const OPTS = { keepRecentTokens: 200, boundaryQuantum: 1 } as const
  const contentOf = (msgs: Message[], id: string) => {
    for (const m of pruneWireMessages(msgs, OPTS)) {
      if (m.role !== 'tool') continue
      for (const r of m.results) if (r.toolCallId === id) return contentText(r.content)
    }
    return ''
  }

  it('a read whose file was later WRITTEN must not offer a verbatim replay', () => {
    const msgs = wire([
      { id: 'a', name: 'Read', args: { path: 'src/a.ts' }, content: body('old') },
      {
        id: 'w',
        name: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        content: 'Wrote src/a.ts',
      },
    ])
    const out = contentOf(msgs, 'a')
    expect(out).toContain('the file has CHANGED since this read')
    expect(out).not.toContain('ToolOutput')
  })

  it('a read the model later re-read points at the newer result, not at a replay', () => {
    const msgs = wire([
      { id: 'a', name: 'Read', args: { path: 'src/a.ts' }, content: body('old') },
      { id: 'b', name: 'Read', args: { path: 'src/a.ts' }, content: body('new') },
    ])
    const out = contentOf(msgs, 'a')
    expect(out).toContain('a NEWER read of the same file appears later')
    expect(out).not.toContain('ToolOutput')
  })

  it('an untouched read that only lost the live-read budget still offers ToolOutput', () => {
    const msgs = wire([
      { id: 'a', name: 'Read', args: { path: 'src/a.ts' }, content: body('only') },
    ])
    const out = contentText(
      pruneWireMessages(msgs, { ...OPTS, maxLiveReads: 0 }).find((m) => m.role === 'tool')
        ?.results[0].content,
    )
    expect(out).toContain('ToolOutput(action="get", tool_call_id="a")')
  })

  it('every fate still marks the result as elided, so the pass stays idempotent', () => {
    const msgs = wire([
      { id: 'a', name: 'Read', args: { path: 'src/a.ts' }, content: body('old') },
      {
        id: 'w',
        name: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        content: 'Wrote src/a.ts',
      },
    ])
    expect(collectElidedToolCallIds(pruneWireMessages(msgs, OPTS))).toContain('a')
    const once = pruneWireMessages(msgs, OPTS)
    expect(JSON.stringify(pruneWireMessages(once, OPTS))).toBe(JSON.stringify(once))
  })
})

/**
 * The pressure gate is a fraction of the context window — a statement about the whole REQUEST.
 * It compared only the message list, ignoring the five-figure system-prompt + tool-schema floor
 * that every request also carries, so it opened later than the fraction it is expressed as.
 */
describe('pressure gate counts the fixed request overhead', () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: 'tool' as const,
    results: [{ toolCallId: `t${i}`, toolName: 'Read', content: 'x'.repeat(2000) }],
  })) as never as Message[]

  it('stays verbatim when messages alone are below the gate', () => {
    expect(
      pruneWireMessages([...messages], {
        pressureTokens: 20_000,
        minKeepRecent: 1,
        keepRecentTokens: 1,
      }),
    ).toEqual(messages)
  })

  it('opens once the overhead is counted too', () => {
    const pruned = pruneWireMessages([...messages], {
      pressureTokens: 20_000,
      fixedOverheadTokens: 12_000,
      minKeepRecent: 1,
      keepRecentTokens: 1,
    })
    expect(pruned).not.toEqual(messages)
  })
})
