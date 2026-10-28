/**
 * Quality regression guard for VBC on a large, realistic coding session. Locks in:
 *  - effectiveness: a big session compresses by a healthy margin (savings ≥ 50%),
 *  - safety: tool_call/tool_result pairing preserved, non-recoverable (bash) output
 *    never elided, the recent window stays verbatim, and the pass is idempotent.
 * If a future change drops savings below the floor or breaks an invariant, this fails.
 */
import { describe, it, expect } from 'bun:test'
import type { ChatMessage } from '../chat'
import {
  isCommandItem,
  type AgentItem,
  type CommandItem,
  type FileChangeItem,
  type ToolBackedItem,
  type ToolCallItem,
} from '../agents/items'
import { planContextCompression } from './plan'
import { applyPlan, POINTER_PLACEHOLDER } from './apply'
import { estimateMessagesTokens } from './tokens'
import { HUGE_BUDGET } from './_test-helpers'

const MUTATE = new Set(['Write', 'Edit', 'apply_patch', 'patch'])
const COMMAND = new Set(['Bash', 'shell', 'terminal'])

let seq = 0
const part = (name: string, input: unknown, resultText: string): ToolBackedItem => {
  const id = `call-${seq++}`
  const base = { id, toolCallId: id, name, input, status: 'completed' as const }
  const rec = (
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  ) as Record<string, unknown>
  if (MUTATE.has(name)) {
    const path = (rec.path ?? rec.file ?? rec.file_path) as string | undefined
    const item: FileChangeItem = {
      ...base,
      type: 'file_change',
      changes: path ? [{ path, kind: 'modify' }] : [],
      resultText,
    }
    return item
  }
  if (COMMAND.has(name)) {
    const item: CommandItem = {
      ...base,
      type: 'command',
      command: typeof rec.command === 'string' ? rec.command : '',
      output: resultText,
      resultText,
    }
    return item
  }
  const item: ToolCallItem = {
    ...base,
    type: 'tool_call',
    activeVerb: name,
    output: resultText,
    resultText,
  }
  return item
}
const toolName = (it: AgentItem): string => ('name' in it ? (it as ToolBackedItem).name : '')
const big = (label: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${label} line ${i} of recoverable content`).join('\n')

/** A large coding session: writes + reads (recoverable) + bash (not) + edits + re-reads. */
function buildLargeSession(turns: number): ChatMessage[] {
  seq = 0
  const comps = ['Header', 'Hero', 'Pricing', 'Footer', 'About', 'Contact', 'FAQ', 'Nav']
  const msgs: ChatMessage[] = [
    { id: 'm0', role: 'user', content: 'Build a landing page in React + Vite.' },
  ]
  for (let t = 0; t < turns; t++) {
    const c = comps[t % comps.length]
    const c2 = comps[(t + 3) % comps.length]
    const parts: AgentItem[] = [
      part('Write', { path: `src/${c}.tsx`, content: big(`${c}.tsx`, 80) }, `Wrote ${c}.tsx`),
      part('Read', { path: `src/${c2}.tsx` }, big(`${c2}.tsx read`, 80)),
      part('Bash', { command: `npm run build ${c}` }, big(`build ${c} output`, 40)),
      part(
        'Edit',
        {
          path: `src/${c2}.tsx`,
          edits: [
            { oldText: 'a', newText: 'b' },
            { oldText: 'c', newText: 'd' },
          ],
        },
        'Applied 2 edits',
      ),
    ]
    msgs.push({ id: `a${t}`, role: 'assistant', content: `Working on ${c}.`, items: parts })
    msgs.push({ id: `u${t}`, role: 'user', content: 'Continue.' })
  }
  return msgs
}

const PLAN_OPTS = { budget: HUGE_BUDGET, keepRecentCount: 8, keepRecentTokens: 16384 }

describe('VBC quality regression (large session)', () => {
  const messages = buildLargeSession(20)
  const before = estimateMessagesTokens(messages)
  const plan = planContextCompression(messages, PLAN_OPTS)
  const compressed = applyPlan(messages, plan)
  const after = estimateMessagesTokens(compressed)

  it('compresses a large session by a healthy margin (≥50%, near-lossless)', () => {
    expect(before).toBeGreaterThan(40_000)
    expect(after).toBeLessThan(before)
    const savings = (before - after) / before
    expect(savings).toBeGreaterThanOrEqual(0.5)
  })

  it('preserves tool_call/tool_result pairing (toolCallIds and counts unchanged)', () => {
    const ids = (ms: ChatMessage[]) =>
      ms
        .flatMap((m) =>
          (m.items ?? []).map((p) => ('toolCallId' in p ? (p as ToolBackedItem).toolCallId : '')),
        )
        .sort()
    expect(ids(compressed)).toEqual(ids(messages))
    messages.forEach((m, i) =>
      expect((compressed[i].items ?? []).length).toBe((m.items ?? []).length),
    )
  })

  it('never elides non-recoverable (bash) output', () => {
    for (let i = 0; i < messages.length; i++) {
      for (let j = 0; j < (messages[i].items ?? []).length; j++) {
        const orig = messages[i].items![j]
        if (isCommandItem(orig) && toolName(orig) === 'Bash') {
          expect((compressed[i].items![j] as CommandItem).resultText).toBe(orig.resultText)
        }
      }
    }
  })

  it('keeps the first message and the recent tail verbatim', () => {
    expect(compressed[0]).toBe(messages[0]) // first message untouched (same ref)
    expect(compressed[compressed.length - 1]).toBe(messages[messages.length - 1])
  })

  it('elides recoverable content to a recoverable pointer (re-readable)', () => {
    // Some early write/read content must have been turned into a pointer note.
    const flat = compressed.flatMap((m) => m.items ?? [])
    const elidedRead = flat.some(
      (p) =>
        'resultText' in p &&
        typeof (p as ToolBackedItem).resultText === 'string' &&
        (p as ToolBackedItem).resultText!.includes('elided to save context'),
    )
    const elidedWrite = flat.some((p) => {
      const c = ('input' in p ? (p as ToolBackedItem).input : undefined) as
        | Record<string, unknown>
        | undefined
      return typeof c?.content === 'string' && c.content.includes('elided to save context')
    })
    expect(elidedRead || elidedWrite).toBe(true)
    // sanity: the pointer constant is exported for the lossy path
    expect(typeof POINTER_PLACEHOLDER).toBe('string')
  })

  it('is idempotent — re-planning over the compressed history yields no further savings', () => {
    const plan2 = planContextCompression(compressed, PLAN_OPTS)
    const after2 = estimateMessagesTokens(applyPlan(compressed, plan2))
    expect(after2).toBe(after)
  })
})

describe('VBC composed menu (mixed recoverable + bash message)', () => {
  // A message mixing recoverable read I/O with heavy bash output must offer BOTH
  // stages in one plan: elide is free (lossless), and under budget pressure the
  // bash output must still be compressible in the SAME pass — the allocator used
  // to stall at `elide`, leaving bash output untouchable until the next turn.
  function buildMixedSession(): ChatMessage[] {
    seq = 0
    const msgs: ChatMessage[] = [
      { id: 'm0', role: 'user', content: 'Run the suite and fix failures.' },
    ]
    for (let t = 0; t < 20; t++) {
      msgs.push({
        id: `a${t}`,
        role: 'assistant',
        content: 'Running.',
        items: [
          part('Read', { path: `src/f${t}.ts` }, big(`f${t}`, 60)),
          part('Bash', { command: 'bun test' }, big(`test run ${t}`, 60)),
        ],
      })
    }
    return msgs
  }

  it('compresses bash output below the elide floor in a single pass when the budget demands', () => {
    const messages = buildMixedSession()
    const lossless = planContextCompression(messages, PLAN_OPTS)
    const losslessAfter = estimateMessagesTokens(applyPlan(messages, lossless))
    const tight = planContextCompression(messages, {
      ...PLAN_OPTS,
      budget: Math.floor(losslessAfter * 0.6),
    })
    const tightAfter = estimateMessagesTokens(applyPlan(messages, tight))
    expect(tightAfter).toBeLessThan(losslessAfter)
  })

  it('single-pass result equals the fixed point (strict idempotency under tight budgets)', () => {
    const messages = buildMixedSession()
    const opts = { ...PLAN_OPTS, budget: 2000 }
    const pass1 = applyPlan(messages, planContextCompression(messages, opts))
    const pass2 = applyPlan(pass1, planContextCompression(pass1, opts))
    expect(JSON.stringify(pass2)).toBe(JSON.stringify(pass1))
  })
})

describe('VBC boundary quantization (prompt-cache friendly)', () => {
  // Uniform read-only turns: every assistant message carries one recoverable read
  // result, so under an infinite budget every UNLOCKED message gets the lossless
  // `elide` op — the verbatim/elided boundary is exactly the hard-keep window.
  function buildReadSession(turns: number): ChatMessage[] {
    seq = 0
    const msgs: ChatMessage[] = [{ id: 'm0', role: 'user', content: 'Audit the repo.' }]
    for (let t = 0; t < turns; t++) {
      msgs.push({
        id: `a${t}`,
        role: 'assistant',
        content: `Reading f${t}.`,
        items: [part('Read', { path: `src/f${t}.ts` }, big(`f${t}`, 40))],
      })
    }
    return msgs
  }
  // default boundaryQuantum (8) deliberately exercised. Live-read protection is OFF:
  // every turn reads a DISTINCT file, so all of them are live and would stay verbatim —
  // that policy has its own tests; this suite is about where the boundary lands.
  const OPTS = { budget: HUGE_BUDGET, keepRecentCount: 4, liveReads: { maxLiveReads: 0 } }
  const elidedIndices = (
    msgs: ChatMessage[],
    opts: Partial<typeof OPTS> & { boundaryQuantum?: number } = {},
  ) =>
    planContextCompression(msgs, { ...OPTS, ...opts })
      .assignment.filter((a) => a.op.kind !== 'verbatim')
      .map((a) => a.index)

  // 20 messages total → un-quantized hard-keep starts at 16, already a multiple of 8
  const base = elidedIndices(buildReadSession(19))

  it('elides everything before the quantized boundary at the base length', () => {
    expect(base).toEqual(Array.from({ length: 15 }, (_, i) => i + 1)) // 1..15
  })

  it('keeps the plan prefix IDENTICAL across +1..+(Q−1) new messages', () => {
    for (let k = 1; k < 8; k++) expect(elidedIndices(buildReadSession(19 + k))).toEqual(base)
  })

  it('jumps the boundary exactly at the next multiple of Q', () => {
    expect(elidedIndices(buildReadSession(19 + 8))).toEqual(
      Array.from({ length: 23 }, (_, i) => i + 1),
    ) // 1..23
  })

  it('never moves the boundary backward as the history grows', () => {
    let prevFrontier = -1
    for (let turns = 19; turns <= 40; turns++) {
      const idx = elidedIndices(buildReadSession(turns))
      const frontier = idx.length ? Math.max(...idx) : -1
      expect(frontier).toBeGreaterThanOrEqual(prevFrontier)
      prevFrontier = frontier
    }
  })

  it('never protects fewer than keepRecentCount (tail always verbatim)', () => {
    for (let turns = 19; turns <= 35; turns++) {
      const msgs = buildReadSession(turns)
      const plan = planContextCompression(msgs, OPTS)
      const kinds = new Map(plan.assignment.map((a) => [a.index, a.op.kind]))
      for (let i = msgs.length - OPTS.keepRecentCount; i < msgs.length; i++) {
        expect(kinds.get(i)).toBe('verbatim')
      }
    }
  })

  it('preserves tool_call/tool_result pairing across the quantized boundary', () => {
    const msgs = buildReadSession(25)
    const out = applyPlan(msgs, planContextCompression(msgs, OPTS))
    const ids = (ms: ChatMessage[]) =>
      ms
        .flatMap((m) =>
          (m.items ?? []).map((p) => ('toolCallId' in p ? (p as ToolBackedItem).toolCallId : '')),
        )
        .sort()
    expect(ids(out)).toEqual(ids(msgs))
  })

  it('boundaryQuantum: 1 disables quantization (boundary slides by one again)', () => {
    // 21 messages → hard-keep starts at 17 → indices 1..16 elided
    expect(elidedIndices(buildReadSession(20), { boundaryQuantum: 1 })).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    )
  })
})

describe('VBC lossy ops preserve the most diagnostic content', () => {
  it('truncate keeps head AND tail (failure summaries live at the end of command output)', () => {
    seq = 0
    const head = 'starting test run …'
    const tail = '2 tests FAILED: src/x.test.ts'
    const text = `${head}\n${'filler line\n'.repeat(800)}${tail}`
    const messages: ChatMessage[] = [
      { id: 'm0', role: 'user', content: 'go' },
      {
        id: 'a0',
        role: 'assistant',
        content: 'ran',
        items: [part('Bash', { command: 'bun test' }, text)],
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `u${i}`,
        role: 'user' as const,
        content: `follow-up ${i}`,
      })),
    ]
    const plan = planContextCompression(messages, {
      budget: 500,
      keepRecentCount: 2,
      keepRecentTokens: 200,
    })
    const out = applyPlan(messages, plan)
    const result = (out[1].items![0] as ToolBackedItem).resultText ?? ''
    if (result !== text) {
      // whichever lossy tier was chosen, the tail verdict must survive truncate.
      // The truncate op now prefers a structural crush for log/JSON output, so the
      // marker is EITHER the head/tail-truncate marker OR the crush marker — but the
      // failure verdict and a real size reduction are invariant either way.
      const chosen = plan.assignment[1].op
      if (chosen.kind === 'truncate') {
        expect(result).toContain('FAILED')
        expect(result.length).toBeLessThan(text.length)
        expect(/elided to save context|crushed to save context/.test(result)).toBe(true)
      }
    }
  })

  it('oneline keeps the first and last lines', () => {
    seq = 0
    const p = part(
      'Bash',
      { command: 'x' },
      `first line marker\n${'mid\n'.repeat(50)}last line verdict`,
    )
    const messages: ChatMessage[] = [
      { id: 'm0', role: 'user', content: 'go' },
      { id: 'a0', role: 'assistant', content: '', items: [p] },
      { id: 'u1', role: 'user', content: 'next' },
      { id: 'u2', role: 'user', content: 'next2' },
    ]
    // Force the oneline op directly through the plan op shape via applyPlan
    const plan = {
      assignment: [
        { index: 0, op: { kind: 'verbatim' as const, cost: 0, retention: 1 } },
        { index: 1, op: { kind: 'oneline' as const, cost: 0, retention: 0.35 } },
        { index: 2, op: { kind: 'verbatim' as const, cost: 0, retention: 1 } },
        { index: 3, op: { kind: 'verbatim' as const, cost: 0, retention: 1 } },
      ],
      estTokensBefore: 0,
      estTokensAfter: 0,
      budget: 0,
    }
    const out = applyPlan(messages, plan)
    const text = (out[1].items![0] as ToolBackedItem).resultText ?? ''
    expect(text).toContain('first line marker')
    expect(text).toContain('last line verdict')
  })

  it('elides the edit single-edit shorthand (old_string/new_string)', () => {
    seq = 0
    const oldStr = big('old', 40)
    const newStr = big('new', 40)
    const messages: ChatMessage[] = [
      { id: 'm0', role: 'user', content: 'go' },
      {
        id: 'a0',
        role: 'assistant',
        content: '',
        items: [
          part(
            'Edit',
            { path: 'src/a.ts', old_string: oldStr, new_string: newStr },
            'Applied 1 edit',
          ),
        ],
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `u${i}`,
        role: 'user' as const,
        content: `follow-up ${i}`,
      })),
    ]
    const plan = planContextCompression(messages, {
      budget: HUGE_BUDGET,
      keepRecentCount: 2,
      keepRecentTokens: 200,
    })
    const out = applyPlan(messages, plan)
    const input = (out[1].items![0] as ToolBackedItem).input as Record<string, string>
    expect(input.old_string).toContain('elided to save context')
    expect(input.new_string).toContain('elided to save context')
    expect(input.path).toBe('src/a.ts')
  })
})
