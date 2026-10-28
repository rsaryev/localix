import { describe, expect, test } from 'bun:test'
import { buildDepGraph } from './dep-graph'
import { msg, userMsg, namedTool } from './_test-helpers'
import type { ChatMessage } from '../chat'

describe('depScore', () => {
  test('is > 0 when an entity introduced at i reappears at j>i', () => {
    const messages: ChatMessage[] = [
      userMsg('work on src/shared/thing.ts please'),
      msg({ content: 'editing src/shared/thing.ts now' }),
    ]
    const g = buildDepGraph(messages)
    expect(g.depScore(0)).toBeGreaterThan(0)
  })

  test('is 0 for a message whose entities never reappear', () => {
    const messages: ChatMessage[] = [
      userMsg('open src/onlyOnce/unique-aaa.ts'),
      msg({ content: 'unrelated text about something else' }),
    ]
    const g = buildDepGraph(messages)
    expect(g.depScore(0)).toBe(0)
  })

  test('decays with the gap — closer reuse yields a higher score', () => {
    // Entity reused at distance 1.
    const near: ChatMessage[] = [
      userMsg('focus on src/decay/near-target.ts'),
      msg({ content: 'touching src/decay/near-target.ts' }),
    ]
    // Same entity reused at distance 5 (filler in between, no entity overlap).
    const far: ChatMessage[] = [
      userMsg('focus on src/decay/far-target.ts'),
      msg({ content: 'filler one' }),
      msg({ content: 'filler two' }),
      msg({ content: 'filler three' }),
      msg({ content: 'filler four' }),
      msg({ content: 'touching src/decay/far-target.ts' }),
    ]
    const gNear = buildDepGraph(near)
    const gFar = buildDepGraph(far)
    expect(gNear.depScore(0)).toBeGreaterThan(gFar.depScore(0))
  })

  test('reverse recurrence exactly preserves the geometric score for a hot repeated path', () => {
    const count = 2_000
    const halfLife = 8
    const messages = Array.from({ length: count }, (_, i) =>
      msg({ content: `turn ${i}: src/hot/repeated-target.ts` }),
    )
    const graph = buildDepGraph(messages, { recencyHalfLife: halfLife })
    const expected = Array.from({ length: count - 1 }, (_, offset) =>
      Math.pow(0.5, (offset + 1) / halfLife),
    ).reduce((sum, weight) => sum + weight, 0)

    expect(graph.depScore(0)).toBeCloseTo(expected, 10)
    expect(graph.depScore(count - 1)).toBe(0)
  })
})

describe('supersededScore — mutate supersedes earlier read', () => {
  test('a READ of F followed by a successful edit of F supersedes the read', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Read', { path: 'src/f.ts' })] }),
      msg({ items: [namedTool('Edit', { path: 'src/f.ts' }, { state: 'output-available' })] }),
    ]
    const g = buildDepGraph(messages)
    expect(g.supersededScore(0)).toBeGreaterThan(0)
  })

  test('a later READ of F supersedes an earlier READ of F', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Read', { path: 'src/g.ts' })] }),
      msg({ items: [namedTool('Read', { path: 'src/g.ts' })] }),
    ]
    const g = buildDepGraph(messages)
    expect(g.supersededScore(0)).toBeGreaterThan(0)
  })
})

describe('supersededScore — non-superseding cases', () => {
  test('a FAILED mutate does NOT supersede an earlier read', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Read', { path: 'src/h.ts' })] }),
      msg({ items: [namedTool('Edit', { path: 'src/h.ts' }, { state: 'output-error' })] }),
    ]
    const g = buildDepGraph(messages)
    expect(g.supersededScore(0)).toBe(0)
  })

  test('a bash re-run does NOT supersede an earlier read', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Read', { path: 'src/i.ts' })] }),
      msg({ items: [namedTool('Bash', { command: 'cat src/i.ts' })] }),
    ]
    const g = buildDepGraph(messages)
    expect(g.supersededScore(0)).toBe(0)
  })

  test('a mutate IS superseded by a later mutate of the same file (overwritten)', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Edit', { path: 'src/j.ts' }, { state: 'output-available' })] }),
      msg({ items: [namedTool('Edit', { path: 'src/j.ts' }, { state: 'output-available' })] }),
    ]
    const g = buildDepGraph(messages)
    expect(g.supersededScore(0)).toBeGreaterThan(0)
  })

  test('a mutate is NOT superseded by a later read (the edit is the action of record)', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Edit', { path: 'src/j.ts' }, { state: 'output-available' })] }),
      msg({ items: [namedTool('Read', { path: 'src/j.ts' })] }),
    ]
    const g = buildDepGraph(messages)
    expect(g.supersededScore(0)).toBe(0)
  })

  test('a read of a DIFFERENT file is not superseded', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Read', { path: 'src/k.ts' })] }),
      msg({ items: [namedTool('Edit', { path: 'src/other.ts' }, { state: 'output-available' })] }),
    ]
    const g = buildDepGraph(messages)
    expect(g.supersededScore(0)).toBe(0)
  })

  test('a later read does not retroactively supersede a future read (only earlier ones)', () => {
    const messages: ChatMessage[] = [
      msg({ items: [namedTool('Read', { path: 'src/l.ts' })] }),
      msg({ items: [namedTool('Read', { path: 'src/l.ts' })] }),
    ]
    const g = buildDepGraph(messages)
    // The last read has nothing after it → not superseded.
    expect(g.supersededScore(1)).toBe(0)
  })
})
