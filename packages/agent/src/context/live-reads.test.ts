/**
 * Live reads survive VBC untouched. VBC's granularity is the MESSAGE — a persisted
 * assistant message is a whole agent run — so one `elide` op would otherwise collapse
 * every read in that run, including the read of the file the next call is about to patch.
 */
import { describe, expect, it } from 'bun:test'
import type { ChatMessage } from '../chat'
import { classifyReads, liveReadItemIds } from './live-reads'
import { planContextCompression } from './plan'
import { applyPlan } from './apply'
import { HUGE_BUDGET, namedTool } from './_test-helpers'
import type { ToolBackedItem } from '../agents/items'

const body = (label: string) =>
  Array.from({ length: 60 }, (_, i) => `${label} line ${i}`).join('\n')

const readItem = (path: string, result: string) =>
  namedTool('read', { path }, { resultText: result })
const writeItem = (path: string) =>
  namedTool('write', { path, content: 'x' }, { resultText: `Wrote ${path}` })
const id = (it: ToolBackedItem) => it.toolCallId

const session = (items: ToolBackedItem[]): ChatMessage[] => [
  { id: 'm0', role: 'user', content: 'go' },
  { id: 'a0', role: 'assistant', content: 'working', items },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `u${i}`,
    role: 'user' as const,
    content: `next ${i}`,
  })),
]

describe('liveReadItemIds', () => {
  it('keeps the last read of a file, drops an earlier read of the same file', () => {
    const older = readItem('src/a.ts', body('old'))
    const newer = readItem('src/a.ts', body('new'))
    const live = liveReadItemIds(session([older, newer]))
    expect(live.has(id(newer))).toBe(true)
    expect(live.has(id(older))).toBe(false)
  })

  it('a later write of the file supersedes the read', () => {
    const read = readItem('src/a.ts', body('old'))
    expect(liveReadItemIds(session([read, writeItem('src/a.ts')])).has(id(read))).toBe(false)
  })

  it('a FAILED write does not supersede — nothing reached disk, the read is still live', () => {
    // The retry-the-patch scenario this module exists for: read → apply_patch fails
    // ("context not found") → the model retries. Marking the read stale here would
    // force a wasted re-read of a file that did not change.
    const read = readItem('src/a.ts', body('old'))
    const failed = namedTool(
      'write',
      { path: 'src/a.ts', content: 'x' },
      { status: 'failed', errorText: 'boom' },
    )
    const out = classifyReads(session([read, failed]))
    expect(out.live.has(id(read))).toBe(true)
    expect(out.fates.get(id(read))).toBe('live')
  })

  it('a PARTIAL apply_patch mutates only the paths that applied', () => {
    const readA = readItem('src/a.ts', body('a'))
    const readB = readItem('src/b.ts', body('b'))
    const patch = namedTool(
      'apply_patch',
      { patch: 'x' },
      {
        changes: [
          { path: 'src/a.ts', kind: 'modify' },
          { path: 'src/b.ts', kind: 'modify', failed: true, failReason: 'context not found' },
        ],
      },
    )
    const out = classifyReads(session([readA, readB, patch]))
    expect(out.fates.get(id(readA))).toBe('stale') // applied → really changed
    expect(out.fates.get(id(readB))).toBe('live') // failed → still the live copy
    expect(out.live.has(id(readB))).toBe(true)
  })

  it('a short re-read (a few lines) neither qualifies nor supersedes', () => {
    const full = readItem('src/a.ts', body('full'))
    const lines = readItem('src/a.ts', '12: const a = 1\n13: const b = 2')
    const live = liveReadItemIds(session([full, lines]))
    expect(live.has(id(full))).toBe(true)
    expect(live.has(id(lines))).toBe(false)
  })

  it('is bounded by count and by total UTF-8 bytes, most recent first', () => {
    const reads = ['a', 'b', 'c'].map((p) => readItem(`src/${p}.ts`, body(p)))
    const msgs = session(reads)
    expect([...liveReadItemIds(msgs, { maxLiveReads: 2 })].sort()).toEqual(
      [id(reads[1]), id(reads[2])].sort(),
    )
    expect(liveReadItemIds(msgs, { budgetBytes: 10 }).size).toBe(0)
    expect(liveReadItemIds(msgs, { maxLiveReads: 0 }).size).toBe(0)
  })
})

describe('planContextCompression + applyPlan', () => {
  const liveText = body('live')

  it('leaves a live read verbatim while eliding the read it superseded', () => {
    const msgs = session([readItem('src/a.ts', body('old')), readItem('src/a.ts', liveText)])
    const out = applyPlan(
      msgs,
      planContextCompression(msgs, { budget: HUGE_BUDGET, keepRecentCount: 1 }),
    )
    const items = out[1].items!
    expect((items[0] as { resultText: string }).resultText).toContain('elided to save context')
    expect((items[1] as { resultText: string }).resultText).toBe(liveText)
  })

  it('elides the live read once a later write supersedes it', () => {
    const msgs = session([readItem('src/a.ts', liveText), writeItem('src/a.ts')])
    const out = applyPlan(
      msgs,
      planContextCompression(msgs, { budget: HUGE_BUDGET, keepRecentCount: 1 }),
    )
    expect((out[1].items![0] as { resultText: string }).resultText).toContain(
      'elided to save context',
    )
  })

  it('the plan cost matches what applyPlan actually writes (no phantom savings)', () => {
    // The menu must exclude protected items, or the allocator budgets for savings
    // applyPlan never makes.
    const stale = readItem('src/a.ts', body('old'))
    const live = readItem('src/b.ts', liveText)
    const msgs = session([stale, live])
    const plan = planContextCompression(msgs, { budget: HUGE_BUDGET, keepRecentCount: 1 })
    expect(plan.protectedItemIds?.has(id(live))).toBe(true)
    const out = applyPlan(msgs, plan)
    expect((out[1].items![1] as { resultText: string }).resultText).toBe(liveText)
  })

  it('maxLiveReads: 0 restores the historical elide-everything behavior', () => {
    const msgs = session([readItem('src/b.ts', liveText)])
    const plan = planContextCompression(msgs, {
      budget: HUGE_BUDGET,
      keepRecentCount: 1,
      liveReads: { maxLiveReads: 0 },
    })
    expect((applyPlan(msgs, plan)[1].items![0] as { resultText: string }).resultText).toContain(
      'elided to save context',
    )
  })
})

describe('read fates drive the elision pointer', () => {
  const liveText = body('live')

  it('classifies each read as live, stale (file changed) or refreshed (re-read)', () => {
    const stale = readItem('src/a.ts', body('old'))
    const refreshedOld = readItem('src/b.ts', body('b1'))
    const refreshedNew = readItem('src/b.ts', body('b2'))
    const live = readItem('src/c.ts', liveText)
    const msgs = session([stale, writeItem('src/a.ts'), refreshedOld, refreshedNew, live])
    const { fates } = classifyReads(msgs)
    expect(fates.get(id(stale))).toBe('stale')
    expect(fates.get(id(refreshedOld))).toBe('refreshed')
    expect(fates.get(id(refreshedNew))).toBe('live')
    expect(fates.get(id(live))).toBe('live')
  })

  it('a stale read is elided WITHOUT a tool_output replay of bytes that no longer exist', () => {
    const stale = readItem('src/a.ts', body('old'))
    const msgs = session([stale, writeItem('src/a.ts')])
    const out = applyPlan(
      msgs,
      planContextCompression(msgs, { budget: HUGE_BUDGET, keepRecentCount: 1 }),
    )
    const text = (out[1].items![0] as { resultText: string }).resultText
    expect(text).toContain('the file has CHANGED since this read')
    expect(text).not.toContain('tool_output')
  })

  it('a refreshed read points at the newer read instead of a replay', () => {
    const older = readItem('src/a.ts', body('old'))
    const newer = readItem('src/a.ts', liveText)
    const msgs = session([older, newer])
    const out = applyPlan(
      msgs,
      planContextCompression(msgs, { budget: HUGE_BUDGET, keepRecentCount: 1 }),
    )
    const text = (out[1].items![0] as { resultText: string }).resultText
    expect(text).toContain('a NEWER read of the same file appears later')
    expect(text).not.toContain('tool_output')
  })

  it('an untouched read that lost the live-read budget still offers tool_output', () => {
    const msgs = session([readItem('src/a.ts', liveText)])
    const plan = planContextCompression(msgs, {
      budget: HUGE_BUDGET,
      keepRecentCount: 1,
      liveReads: { maxLiveReads: 0 },
    })
    expect((applyPlan(msgs, plan)[1].items![0] as { resultText: string }).resultText).toContain(
      'tool_output',
    )
  })
})

describe('batched reads', () => {
  const batch = (paths: string[]) =>
    namedTool('read', { reads: paths.map((path) => ({ path })) }, { resultText: body('batch') })

  it('a later read of ONE of its files leaves the batch live — it is the only copy of the others', () => {
    const read = batch(['src/a.ts', 'src/b.ts'])
    const out = classifyReads(session([read, readItem('src/a.ts', body('a again'))]))
    expect(out.fates.get(id(read))).toBe('live')
    expect(out.live.has(id(read))).toBe(true)
  })

  it('it is refreshed only when every file was read again', () => {
    const read = batch(['src/a.ts', 'src/b.ts'])
    const out = classifyReads(
      session([read, readItem('src/a.ts', body('a')), readItem('src/b.ts', body('b'))]),
    )
    expect(out.fates.get(id(read))).toBe('refreshed')
  })

  it('a change to any one of its files makes it stale', () => {
    const read = batch(['src/a.ts', 'src/b.ts'])
    const out = classifyReads(session([read, writeItem('src/b.ts')]))
    expect(out.fates.get(id(read))).toBe('stale')
    expect(out.live.has(id(read))).toBe(false)
  })
})
