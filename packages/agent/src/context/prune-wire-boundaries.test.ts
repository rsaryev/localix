/**
 * BOUNDARY tests for `pruneWireMessages` — the per-request wire elision.
 *
 * This is the layer with the most thresholds and the least coverage of them: a mutation
 * sweep found 34 comparisons here that the whole context suite could not distinguish,
 * because every fixture sits in the MIDDLE of a range and a mid-range fixture cannot tell
 * `>` from `>=`. A wrong one does not crash, does not fail a type-check and does not fail
 * a test — it silently changes what the model can still see, and the only symptom is an
 * agent that mysteriously "forgot" a file it just read.
 *
 * Each test sits exactly ON a threshold and names the mutation it kills. Where the
 * on-boundary assertion is a negative ("left verbatim", "not collected"), it is paired
 * with a control one step away, so the assertion is provably able to flip.
 */
import { describe, expect, it } from 'bun:test'
import type { Message, TextContent, ToolCall, ToolResult } from '../types'
import {
  collectElidedArgToolCallIds,
  collectElidedToolCallIds,
  pruneWireMessages,
  DEFAULT_LIVE_READ_BUDGET_BYTES,
  MIDDLE_TRUNCATE_MARKER,
  type PruneWireOptions,
} from './prune-wire'
import { ELISION_MARKER } from './op-menu'
import { CRUSH_MARKER, crushNonRecoverable } from './crushers'
import { estimateTextTokens } from './tokens'

// ---- wire builders -------------------------------------------------------------

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 })
const tc = (id: string, name: string, args: unknown): ToolCall => ({
  type: 'tool_call',
  id,
  name,
  arguments: args,
})
const calls = (...tcs: ToolCall[]): Message => ({
  role: 'assistant',
  content: tcs,
  model: 'm',
  timestamp: 0,
})
const result = (
  toolCallId: string,
  toolName: string,
  content: ToolResult['content'],
  isError?: true,
): Message => ({
  role: 'tool',
  results: [
    { type: 'tool_result', toolCallId, toolName, content, ...(isError ? { isError } : {}) },
  ],
  timestamp: 0,
})

/** Wrap a body so that ONLY message 0 and the last message are locked — everything between is prunable. */
const wire = (...body: Message[]): Message[] => [user('the task'), ...body, user('done')]

/**
 * Open the prune window as wide as it goes: no quantization, no token headroom, a
 * single always-kept trailing message. With `wire()` above this locks exactly {0, N−1}.
 *
 * `liveReadBudgetBytes` is pinned to the budget's own default for clarity. This USED to
 * be mandatory: the default was derived as `4 × keepRecentTokens`, which is 0 here — a
 * legal `keepRecentTokens: 0` therefore switched live-read protection off and masked every
 * threshold below. That fail-open is fixed (the default now floors at
 * `DEFAULT_LIVE_READ_BUDGET_BYTES`; see `prune-wire-degenerate.test.ts`), so the pin is now
 * belt-and-suspenders — the same number the resolver would supply — not a workaround.
 */
const OPEN: PruneWireOptions = {
  keepRecentTokens: 0,
  minKeepRecent: 1,
  boundaryQuantum: 1,
  liveReadBudgetBytes: DEFAULT_LIVE_READ_BUDGET_BYTES,
}

/** The wire estimator (`estTokens`), duplicated so a gate can be placed EXACTLY on its own boundary. */
const est = (m: Message) => estimateTextTokens(JSON.stringify(m))

const contentOf = (ms: Message[], id: string) =>
  ms.flatMap((m) => (m.role === 'tool' ? m.results : [])).find((r) => r.toolCallId === id)?.content

const argsOf = (ms: Message[], id: string) => {
  for (const m of ms) {
    if (m.role !== 'assistant' || typeof m.content === 'string') continue
    for (const part of m.content) {
      const t = part as ToolCall
      if (t.type === 'tool_call' && t.id === id)
        return t.arguments as Record<string, unknown> | null
    }
  }
  return undefined
}

// ---- content fixtures ----------------------------------------------------------

/** A blob NEITHER crusher can shrink: not JSON, and under the log crusher's 25-line floor. */
const uncrushable = (chars: number, lines = 10): string => {
  const body = Array.from({ length: lines }, (_, i) => `plain segment ${i}`)
  body[lines - 1] += '.'.repeat(chars - body.join('\n').length)
  const s = body.join('\n')
  if (s.length !== chars) throw new Error(`bad fixture: want ${chars}, got ${s.length}`)
  return s
}

/** A blob the log crusher CAN shrink: ≥25 lines, with the bulk on a line it drops. */
const crushable = (chars: number, lines = 40): string => {
  const body = Array.from({ length: lines }, (_, i) => `noise line ${i}`)
  body[10] += '.'.repeat(chars - body.join('\n').length)
  const s = body.join('\n')
  if (s.length !== chars) throw new Error(`bad fixture: want ${chars}, got ${s.length}`)
  return s
}

/** An `edits` array whose JSON.stringify is EXACTLY `n` chars. */
const editsOfJsonLength = (n: number) => {
  const probe = [{ old_string: 'a', new_string: '' }]
  const out = [{ old_string: 'a', new_string: 'b'.repeat(n - JSON.stringify(probe).length) }]
  if (JSON.stringify(out).length !== n) throw new Error('bad fixture')
  return out
}

const MIN_ELIDE = 400 // PruneWireOptions.minElideChars default
const CRUSH_FLOOR = 1000 // CRUSH_MIN_CHARS
const HEAD_TAIL = 4500 // MIDDLE_TRUNCATE_HEAD + _TAIL + 500
const LIVE = 'L'.repeat(800)

// ================================================================================

describe('pruneWireMessages — the mutate-arg elision floor (minElideChars)', () => {
  // Kills: `v.length > minChars` (heavy mutate fields) → `>=`.
  it('a mutate arg EXACTLY at minElideChars is left verbatim', () => {
    const content = 'C'.repeat(MIN_ELIDE)
    const ms = wire(
      calls(tc('w1', 'write', { path: 'a.ts', content })),
      result('w1', 'write', 'ok'),
    )
    expect(argsOf(pruneWireMessages(ms, OPEN), 'w1')!.content).toBe(content)
  })

  it('one char over it, the same arg is elided to a pointer', () => {
    const content = 'C'.repeat(MIN_ELIDE + 1)
    const ms = wire(
      calls(tc('w1', 'write', { path: 'a.ts', content })),
      result('w1', 'write', 'ok'),
    )
    expect(argsOf(pruneWireMessages(ms, OPEN), 'w1')!.content).toContain(ELISION_MARKER)
  })

  // Kills: `if (json.length > minChars && !json.includes(ELISION_MARKER))` → `>=`, and → `||`
  // (the `||` mutant elides EVERY edits array, however small).
  it('an `edits` array whose JSON is EXACTLY minElideChars is left verbatim', () => {
    const edits = editsOfJsonLength(MIN_ELIDE)
    const ms = wire(calls(tc('e1', 'edit', { path: 'a.ts', edits })), result('e1', 'edit', 'ok'))
    expect(argsOf(pruneWireMessages(ms, OPEN), 'e1')!.edits).toEqual(edits)
  })

  it('one char over it, the same `edits` array is elided', () => {
    const edits = editsOfJsonLength(MIN_ELIDE + 1)
    const ms = wire(calls(tc('e1', 'edit', { path: 'a.ts', edits })), result('e1', 'edit', 'ok'))
    expect(argsOf(pruneWireMessages(ms, OPEN), 'e1')!.edits).toContain(ELISION_MARKER)
  })
})

describe('pruneWireMessages — output size bounds', () => {
  // The bash COMMAND arg is bounded like the bash OUTPUT is: a heredoc body is not
  // pointer-recoverable, so only head+tail can bound it.
  // Kills: `cmd.length > MIDDLE_TRUNCATE_THRESHOLD` → `>=`.
  it('a bash command arg EXACTLY at the head+tail threshold is left verbatim', () => {
    const command = uncrushable(HEAD_TAIL)
    const ms = wire(calls(tc('b1', 'bash', { command })), result('b1', 'bash', 'out'))
    expect(argsOf(pruneWireMessages(ms, OPEN), 'b1')!.command).toBe(command)
  })

  it('one char over it, the same command is head+tail bounded', () => {
    const command = uncrushable(HEAD_TAIL + 1)
    const ms = wire(calls(tc('b1', 'bash', { command })), result('b1', 'bash', 'out'))
    expect(argsOf(pruneWireMessages(ms, OPEN), 'b1')!.command).toContain(MIDDLE_TRUNCATE_MARKER)
  })

  // `boundLargeOutput` falls back to head+tail truncation ONLY for the >4500-char giants;
  // a mid-size output with no usable structure is left alone rather than blindly cut.
  // Kills: `if (s.length > MIDDLE_TRUNCATE_THRESHOLD)` (inside boundLargeOutput) → `>=`.
  it('an unstructured result EXACTLY at the head+tail threshold is left verbatim', () => {
    const out = uncrushable(HEAD_TAIL)
    const ms = wire(calls(tc('b1', 'bash', { command: 'run' })), result('b1', 'bash', out))
    expect(contentOf(pruneWireMessages(ms, OPEN), 'b1')).toBe(out)
  })

  it('one char over it, the same result is head+tail bounded', () => {
    const out = uncrushable(HEAD_TAIL + 1)
    const ms = wire(calls(tc('b1', 'bash', { command: 'run' })), result('b1', 'bash', out))
    expect(contentOf(pruneWireMessages(ms, OPEN), 'b1')).toContain(MIDDLE_TRUNCATE_MARKER)
  })

  // Below the crush floor an output is not worth bounding at all.
  // Kills: `if (r.content.length > threshold)` → `>=`.
  it('a structured result EXACTLY at the crush floor is left verbatim', () => {
    const out = crushable(CRUSH_FLOOR)
    const ms = wire(calls(tc('b1', 'bash', { command: 'run' })), result('b1', 'bash', out))
    expect(contentOf(pruneWireMessages(ms, OPEN), 'b1')).toBe(out)
  })

  it('one char over it, the same result is structurally crushed', () => {
    const out = crushable(CRUSH_FLOOR + 1)
    const ms = wire(calls(tc('b1', 'bash', { command: 'run' })), result('b1', 'bash', out))
    expect(contentOf(pruneWireMessages(ms, OPEN), 'b1')).toContain(CRUSH_MARKER)
  })

  // Kills: `READ_RESULT_TOOLS.has(r.toolName) && !r.isError && r.content.length > minChars` → `>=`.
  // (maxLiveReads:0 — otherwise live-read protection masks the comparison entirely.)
  it('a read result EXACTLY at minElideChars is left verbatim', () => {
    const body = 'R'.repeat(MIN_ELIDE)
    const ms = wire(calls(tc('r1', 'read', { path: 'a.ts' })), result('r1', 'read', body))
    expect(contentOf(pruneWireMessages(ms, { ...OPEN, maxLiveReads: 0 }), 'r1')).toBe(body)
  })

  it('one char over it, the same read result is pointered', () => {
    const body = 'R'.repeat(MIN_ELIDE + 1)
    const ms = wire(calls(tc('r1', 'read', { path: 'a.ts' })), result('r1', 'read', body))
    expect(contentOf(pruneWireMessages(ms, { ...OPEN, maxLiveReads: 0 }), 'r1')).toContain(
      ELISION_MARKER,
    )
  })
})

describe('pruneWireMessages — which bound WINS (boundLargeOutput)', () => {
  // These two comparisons are TIES between two lengths derived from the crusher's own
  // output, so a hard-coded fixture would byte-couple this file to the crush/truncation
  // PROSE — which the codebase deliberately owns in one place. The tie is SEARCHED for
  // instead: the boundary stays pinned and the wording stays free to change.

  /** A crushable body of exactly `chars`, with `keptPad` extra chars on a line the crusher KEEPS. */
  const tieBody = (chars: number, keptPad: number, lines = 40): string => {
    const body = Array.from({ length: lines }, (_, i) => `noise line ${i}`)
    body[35] += '.'.repeat(keptPad) // a KEPT tail line — grows the crushed output
    const need = chars - body.join('\n').length
    if (need < 0) return ''
    body[10] += '.'.repeat(need) // a DROPPED middle line — grows only the original
    return body.join('\n')
  }

  const search = (
    chars: number,
    hit: (s: string, crushedLen: number) => boolean,
  ): string | undefined => {
    for (let keptPad = 0; keptPad <= 4200; keptPad++) {
      const s = tieBody(chars, keptPad)
      if (s.length !== chars) continue
      const c = crushNonRecoverable(s, { locator: 'b1' })
      if (c && hit(s, c.text.length)) return s
    }
    return undefined
  }

  const bashOut = (out: string) =>
    wire(calls(tc('b1', 'bash', { command: 'run' })), result('b1', 'bash', out))

  // A crush that shrinks the output to EXACTLY 70% still wins. The `<` mutant makes it lose —
  // and since 1000 < chars <= 4500 there is no head+tail fallback either, so the output goes
  // out COMPLETELY UNBOUNDED.
  // Kills: `if (crushed && crushed.text.length <= s.length * 0.7) return crushed.text` → `<`.
  it('a crush landing EXACTLY on the 0.7 shrink ratio is applied', () => {
    const s = search(1010, (src, len) => len === src.length * 0.7)
    expect(s).toBeDefined() // if this fails, re-derive the tie — the crusher's shape moved
    expect(contentOf(pruneWireMessages(bashOut(s!), OPEN), 'b1')).toContain(CRUSH_MARKER)
  })

  // Above 4500 the loser of the ratio test still gets head+tail truncation. When the two
  // candidates are the SAME length the structural crush wins — it keeps far more signal per
  // kept char, and it is reversible.
  // Kills: `crushed && crushed.text.length <= truncated.length ? crushed.text : truncated` → `<`.
  it('a crush exactly TIED with head+tail truncation still wins (more signal per char)', () => {
    // truncateMiddle's length is OBSERVED through the real code path (an uncrushable body of
    // the same size must fall back to it) rather than re-typed here.
    const CHARS = 4501
    const truncatedLen = (
      contentOf(pruneWireMessages(bashOut(uncrushable(CHARS)), OPEN), 'b1') as string
    ).length
    expect(truncatedLen).toBeGreaterThan(0)

    const s = search(CHARS, (src, len) => len > src.length * 0.7 && len === truncatedLen)
    expect(s).toBeDefined() // must LOSE the 0.7 test (else it never reaches this comparison)
    const out = contentOf(pruneWireMessages(bashOut(s!), OPEN), 'b1') as string
    expect(out).toContain(CRUSH_MARKER)
    expect(out).not.toContain(MIDDLE_TRUNCATE_MARKER)
  })
})

describe('pruneWireMessages — what supersedes a LIVE read', () => {
  const liveRead = () =>
    [calls(tc('r1', 'read', { path: 'a.ts' })), result('r1', 'read', LIVE)] as const

  // A read result AT minChars (a few lines of the file) is too little to stand in for the
  // live read, so it must not evict it.
  // Kills: `if (size > minChars) … supersededAfter.set(k, order)` → `>=`.
  it('a minChars-sized re-read does not supersede the live read', () => {
    const ms = wire(
      ...liveRead(),
      calls(tc('r2', 'read', { path: 'a.ts' })),
      result('r2', 'read', 'S'.repeat(MIN_ELIDE)),
    )
    expect(contentOf(pruneWireMessages(ms, OPEN), 'r1')).toBe(LIVE)
  })

  it('one char over minChars, the re-read DOES supersede it', () => {
    const ms = wire(
      ...liveRead(),
      calls(tc('r2', 'read', { path: 'a.ts' })),
      result('r2', 'read', 'S'.repeat(MIN_ELIDE + 1)),
    )
    expect(contentOf(pruneWireMessages(ms, OPEN), 'r1')).toContain(ELISION_MARKER)
  })

  // A batched read is the only copy of every file it holds: re-reading ONE of them must
  // not elide it, while a batch that re-delivers the file supersedes an earlier single read.
  it('a re-read of one file of a batched read leaves the batch live', () => {
    const ms = wire(
      calls(tc('r1', 'read', { reads: [{ path: 'a.ts' }, { path: 'b.ts' }] })),
      result('r1', 'read', LIVE),
      calls(tc('r2', 'read', { path: 'a.ts' })),
      result('r2', 'read', 'S'.repeat(MIN_ELIDE + 1)),
    )
    expect(contentOf(pruneWireMessages(ms, OPEN), 'r1')).toBe(LIVE)
  })

  it('a batched re-read that delivers the file supersedes the single read', () => {
    const ms = wire(
      ...liveRead(),
      calls(tc('r2', 'read', { reads: [{ path: 'a.ts' }] })),
      result('r2', 'read', 'S'.repeat(MIN_ELIDE + 1)),
    )
    expect(contentOf(pruneWireMessages(ms, OPEN), 'r1')).toContain(ELISION_MARKER)
  })

  // A FAILED read delivered no bytes: the earlier read is still the model's only copy.
  // Kills: `READ_RESULT_TOOLS.has(tc.name) && resultOk.get(tc.id) === true` → `||`.
  it('a FAILED re-read does not supersede the live read it was retrying', () => {
    const ms = wire(
      ...liveRead(),
      calls(tc('r2', 'read', { path: 'a.ts' })),
      result('r2', 'read', 'E'.repeat(800), true),
    )
    expect(contentOf(pruneWireMessages(ms, OPEN), 'r1')).toBe(LIVE)
  })

  // A structured (non-string) result carries no measurable bytes for this layer.
  // Kills: `if (!r.toolCallId || typeof r.content !== 'string') continue` (in liveReadCallIds) → `&&`.
  it('a structured (non-string) re-read does not supersede the live read', () => {
    const blocks: TextContent[] = Array.from({ length: MIN_ELIDE + 1 }, () => ({
      type: 'text',
      text: 'x',
    }))
    const ms = wire(
      ...liveRead(),
      calls(tc('r2', 'read', { path: 'a.ts' })),
      result('r2', 'read', blocks),
    )
    expect(contentOf(pruneWireMessages(ms, OPEN), 'r1')).toBe(LIVE)
  })
})

describe('pruneWireMessages — the live-read budget', () => {
  // Kills: `if (chars <= minChars || bytes > budgetBytes) return false` → `chars < minChars`
  // (which lets a never-elided short read take the last live-read slot from a real read).
  it('a minChars-sized read does not consume a live-read slot', () => {
    const ms = wire(
      calls(tc('r1', 'read', { path: 'a.ts' })),
      result('r1', 'read', LIVE),
      calls(tc('r2', 'read', { path: 'b.ts' })), // MORE RECENT, so it wins the slot if eligible
      result('r2', 'read', 'S'.repeat(MIN_ELIDE)),
    )
    expect(contentOf(pruneWireMessages(ms, { ...OPEN, maxLiveReads: 1 }), 'r1')).toBe(LIVE)
  })

  // Kills: `bytes > budgetBytes` → `>=`, and `if (spent + bytes > budgetBytes) continue` → `>=`.
  it('a read landing EXACTLY on the live-read budget is still protected', () => {
    const ms = wire(calls(tc('r1', 'read', { path: 'a.ts' })), result('r1', 'read', LIVE))
    expect(contentOf(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: 800 }), 'r1')).toBe(LIVE)
  })

  it('one byte over the budget, the same ASCII read is pointered', () => {
    const ms = wire(
      calls(tc('r1', 'read', { path: 'a.ts' })),
      result('r1', 'read', 'L'.repeat(801)),
    )
    expect(contentOf(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: 800 }), 'r1')).toContain(
      ELISION_MARKER,
    )
  })

  it('applies the byte boundary to CJK while minElideChars remains character-based', () => {
    const cjk = '你'.repeat(MIN_ELIDE + 1) // 401 chars, 1203 UTF-8 bytes
    const ms = wire(calls(tc('r1', 'read', { path: 'cjk.ts' })), result('r1', 'read', cjk))

    expect(contentOf(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: 1203 }), 'r1')).toBe(cjk)
    expect(
      contentOf(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: 1202 }), 'r1'),
    ).toContain(ELISION_MARKER)
  })

  // Kills: `if (spent + bytes > budgetBytes) continue` → `>=`.
  it('the budget is CUMULATIVE: two reads summing exactly to it both survive', () => {
    const a = 'A'.repeat(600)
    const b = 'B'.repeat(600)
    const ms = wire(
      calls(tc('r1', 'read', { path: 'a.ts' })),
      result('r1', 'read', a),
      calls(tc('r2', 'read', { path: 'b.ts' })),
      result('r2', 'read', b),
    )
    const out = pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: 1200 })
    expect(contentOf(out, 'r1')).toBe(a)
    expect(contentOf(out, 'r2')).toBe(b)
  })
})

describe('pruneWireMessages — the gates', () => {
  const content = 'C'.repeat(2000)
  const gated = () =>
    wire(calls(tc('w1', 'write', { path: 'a.ts', content })), result('w1', 'write', 'ok'))

  // Compression is a RESPONSE TO PRESSURE. The gate compares the WHOLE request: every
  // message plus the fixed system-prompt/tool-schema overhead the messages do not carry.
  // Kills: `if (total < pressure) return ratchetOnly()` → `<=`.
  it('compresses when the request cost lands EXACTLY on the pressure gate', () => {
    const ms = gated()
    const OVERHEAD = 500
    const total = ms.reduce((s, m) => s + est(m), 0) + OVERHEAD
    const at = pruneWireMessages(ms, {
      ...OPEN,
      fixedOverheadTokens: OVERHEAD,
      pressureTokens: total,
    })
    expect(argsOf(at, 'w1')!.content).toContain(ELISION_MARKER)

    const under = pruneWireMessages(ms, {
      ...OPEN,
      fixedOverheadTokens: OVERHEAD,
      pressureTokens: total + 1,
    })
    expect(argsOf(under, 'w1')!.content).toBe(content)
  })

  // Kills: `if (unlockedTokens < minReclaim) return ratchetOnly()` → `<=`.
  it('crushes when the crushable region lands EXACTLY on the reclaim floor', () => {
    const ms = gated() // [task, calls, result, done] — OPEN leaves exactly 1..2 unlocked
    const unlocked = est(ms[1]) + est(ms[2])
    const at = pruneWireMessages(ms, { ...OPEN, minReclaimTokens: unlocked })
    expect(argsOf(at, 'w1')!.content).toContain(ELISION_MARKER)

    const under = pruneWireMessages(ms, { ...OPEN, minReclaimTokens: unlocked + 1 })
    expect(argsOf(under, 'w1')!.content).toBe(content)
  })

  // Kills: `if (!within && tail > cap) break` → `>=`.
  it('a message whose trailing sum lands EXACTLY on keepRecentTokens is still protected', () => {
    const ms = gated()
    // sized so the protected tail reaches the CALLS message exactly: everything after it
    // sums to precisely the cap.
    const cap = est(ms[2]) + est(ms[3])
    const opt: PruneWireOptions = { minKeepRecent: 1, boundaryQuantum: 1, keepRecentTokens: cap }
    expect(argsOf(pruneWireMessages(ms, opt), 'w1')!.content).toBe(content)

    const tight = pruneWireMessages(ms, { ...opt, keepRecentTokens: cap - 1 })
    expect(argsOf(tight, 'w1')!.content).toContain(ELISION_MARKER)
  })
})

describe('pruneWireMessages — malformed tool calls', () => {
  // Both null-guards (`elideToolCallArgs` and `wireTargets`) read fields off `arguments`
  // straight after. Their `&&` mutants dereference a null and take the whole request down.
  // Kills: `if (!args || typeof args !== 'object') return undefined` (elideToolCallArgs) → `&&`.
  // Kills: `if (!args || typeof args !== 'object') return []` (wireTargets) → `&&`.
  it('survives a tool call with null arguments', () => {
    const ms = wire(
      calls(tc('w1', 'write', null), tc('r1', 'read', { path: 'a.ts' })),
      result('r1', 'read', LIVE), // forces the lazy live-read scan, which is what reaches wireTargets
    )
    const out = pruneWireMessages(ms, OPEN)
    expect(argsOf(out, 'w1')).toBeNull()
    expect(contentOf(out, 'r1')).toBe(LIVE)
  })
})

describe('pruneWireMessages — the arg ratchet inside the protected tail', () => {
  // An already-pointered arg never re-inflates, even once the tail stretches back over it.
  // But the ratchet must claim ONLY what it names: eliding a tail arg it never took would
  // rewrite the cached prefix for nothing.
  // Kills: `if (tc.type !== 'tool_call' || !argRatchet.has(tc.id)) return part` → `&&`.
  it('re-elides only the calls the ratchet names, and leaves the rest of the tail verbatim', () => {
    const content = 'C'.repeat(2000)
    const ms = wire(
      calls(
        tc('w1', 'write', { path: 'a.ts', content }),
        tc('w2', 'write', { path: 'b.ts', content }),
      ),
    )
    // a huge recent window ⇒ every message is locked; only the ratchet may still touch one
    const out = pruneWireMessages(ms, {
      keepRecentTokens: 1_000_000,
      boundaryQuantum: 1,
      elidedArgToolCallIds: new Set(['w1']),
    })
    expect(argsOf(out, 'w1')!.content).toContain(ELISION_MARKER) // the ratchet holds
    expect(argsOf(out, 'w2')!.content).toBe(content) // …and claims nothing else
  })
})

// ================================================================================
// The two collectors answer "does the model still have that output?" for the host, which
// feeds the answer back as the elision ratchet. A false YES pins a pointer on content that
// was never elided; a false NO lets the ratchet forget an elision.

describe('collectElidedToolCallIds', () => {
  const POINTERED = `[output ${ELISION_MARKER} — 900 chars]`
  const toolMsg = (toolCallId: string): Message => ({
    role: 'tool',
    results: [{ type: 'tool_result', toolCallId, toolName: 'read', content: POINTERED }],
    timestamp: 0,
  })

  // Kills: `if (!r.toolCallId || typeof r.content !== 'string') continue` → `&&`
  // (which collects an empty id, handing the host a handle to nothing).
  it('skips a result with no tool_call_id', () => {
    expect(collectElidedToolCallIds([toolMsg('')])).toEqual([])
    expect(collectElidedToolCallIds([toolMsg('r1')])).toEqual(['r1']) // control: the [] above is not vacuous
  })
})

describe('collectElidedArgToolCallIds', () => {
  const ELIDED_ARG = `[content ${ELISION_MARKER} — 900 chars]`
  const asst = (call: unknown): Message =>
    ({ role: 'assistant', content: [call], model: 'm', timestamp: 0 }) as Message

  // Kills: two of the three `||`s in
  // `if (tc.type !== 'tool_call' || !tc.id || !tc.arguments || typeof tc.arguments !== 'object') continue`.
  it('skips a call with no id', () => {
    expect(collectElidedArgToolCallIds([asst(tc('', 'write', { content: ELIDED_ARG }))])).toEqual(
      [],
    )
    expect(collectElidedArgToolCallIds([asst(tc('w1', 'write', { content: ELIDED_ARG }))])).toEqual(
      ['w1'],
    )
  })

  // Kills: the third `||` (whose `&&` mutant calls `Object.values(null)` and throws).
  it('survives null arguments', () => {
    expect(collectElidedArgToolCallIds([asst(tc('w1', 'write', null))])).toEqual([])
  })

  // Kills: `(v) => typeof v === 'string' && (v.includes(…) || v.includes(…))` → `||`, whose
  // mutant reports EVERY call carrying any string arg as elided — telling the host the model
  // lost content it can still see.
  it('reports only args that actually carry a compression marker', () => {
    expect(
      collectElidedArgToolCallIds([
        asst(tc('w1', 'write', { path: 'a.ts', content: 'plain body' })),
      ]),
    ).toEqual([])
  })
})
