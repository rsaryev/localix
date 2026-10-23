import { describe, expect, it } from 'bun:test'
import {
  extractIdentifiers,
  symbolsNearCursor,
  rankContextWindows,
  packContextWindows,
  pickRelevantExcerpt,
  formatEditEvents,
  formatEditDiff,
  renderWindowGroup,
  type ContextWindowInput,
} from './predict-next-edit-context'
import {
  identifiersForLspLookup,
  baseNameNoExt,
  parseImportBasenames,
} from './predict-context-signals'
import { estimateTokens } from '../../lib/tokens'

describe('extractIdentifiers', () => {
  it('drops keywords + short tokens, dedups', () => {
    const ids = extractIdentifiers('const fooBar = getUser(); if (x) return fooBar')
    expect(ids).toContain('fooBar')
    expect(ids).toContain('getUser')
    expect(ids).not.toContain('const')
    expect(ids).not.toContain('if')
    expect(ids).not.toContain('x') // too short
    // deduped
    expect(ids.filter((i) => i === 'fooBar')).toHaveLength(1)
  })
})

describe('symbolsNearCursor', () => {
  it('only gathers identifiers within the radius of the cursor line', () => {
    const content = ['aaaa', 'bbbb', 'cccc', 'target', 'dddd', 'eeee', 'ffff', 'gggg'].join('\n')
    // cursor on line 4 ('target'), radius 1 → lines 3..5 (cccc,target,dddd)
    const syms = symbolsNearCursor(content, 4, 1)
    expect(syms.has('target')).toBe(true)
    expect(syms.has('cccc')).toBe(true)
    expect(syms.has('dddd')).toBe(true)
    expect(syms.has('aaaa')).toBe(false)
    expect(syms.has('gggg')).toBe(false)
  })
})

describe('identifiersForLspLookup', () => {
  it('returns nearest-first, deduped, capped, with positions', () => {
    const content = ['far', 'alpha beta', 'gamma', 'delta alpha'].join('\n')
    // cursor line 3 ('gamma'); alpha appears on line 2 and 4 → dedup keeps line 2
    const ids = identifiersForLspLookup(content, 3, 2, 3)
    expect(ids[0]).toEqual({ name: 'gamma', line: 2, character: 0 })
    const names = ids.map((i) => i.name)
    expect(names.filter((n) => n === 'alpha')).toHaveLength(1)
    expect(ids.length).toBeLessThanOrEqual(3)
  })
  it('honours the max cap', () => {
    const content = 'one two three four five six seven'
    const ids = identifiersForLspLookup(content, 1, 3, 2)
    expect(ids).toHaveLength(2)
  })
})

describe('baseNameNoExt / parseImportBasenames', () => {
  it('strips dir + extension', () => {
    expect(baseNameNoExt('src/features/editorActivity.ts')).toBe('editorActivity')
    expect(baseNameNoExt('./util')).toBe('util')
  })
  it('parses ES / CJS / python import specifiers', () => {
    const src = [
      "import { a } from './editorActivity'",
      "import 'side-effect'",
      "const x = require('../lib/helper')",
      'from mypkg.utils import thing',
    ].join('\n')
    const set = parseImportBasenames(src)
    expect(set.has('editorActivity')).toBe(true)
    expect(set.has('side-effect')).toBe(true)
    expect(set.has('helper')).toBe(true)
    expect(set.has('utils')).toBe(true)
  })
})

describe('rankContextWindows', () => {
  const mk = (over: Partial<ContextWindowInput>): ContextWindowInput => ({
    filepath: 'a.ts',
    content: 'x',
    source: 'related',
    recencyIndex: 0,
    ...over,
  })

  it('orders provided > lsp > related by base tier', () => {
    const ranked = rankContextWindows(
      [
        mk({ filepath: 'r.ts', content: 'zzz', source: 'related' }),
        mk({ filepath: 'p.ts', content: 'zzz', source: 'provided' }),
        mk({ filepath: 'l.ts', content: 'zzz', source: 'lsp' }),
      ],
      new Set(),
      new Set(),
    )
    expect(ranked.map((r) => r.filepath)).toEqual(['p.ts', 'l.ts', 'r.ts'])
  })

  it('symbol overlap and import-neighbour boost lift a related window', () => {
    const query = new Set(['getUser', 'session'])
    const imports = new Set(['helper'])
    const ranked = rankContextWindows(
      [
        mk({ filepath: 'plain.ts', content: 'const nothing = 1' }),
        mk({ filepath: 'helper.ts', content: 'function getUser(session) {}' }),
      ],
      query,
      imports,
    )
    expect(ranked[0].filepath).toBe('helper.ts')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('dedups by filepath keeping the higher score', () => {
    const ranked = rankContextWindows(
      [
        mk({ filepath: 'dup.ts', content: 'nothing', source: 'related' }),
        mk({ filepath: 'dup.ts', content: 'nothing', source: 'lsp' }),
      ],
      new Set(),
      new Set(),
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0].source).toBe('lsp')
  })

  it('drops blank windows', () => {
    const ranked = rankContextWindows([mk({ content: '   ' })], new Set(), new Set())
    expect(ranked).toHaveLength(0)
  })

  it('ranks the CLOSER LSP window first when everything else is equal (cursor proximity)', () => {
    const ranked = rankContextWindows(
      [
        mk({ filepath: 'far.ts', content: 'zzz', source: 'lsp', proximity: 30 }),
        mk({ filepath: 'near.ts', content: 'zzz', source: 'lsp', proximity: 1 }),
      ],
      new Set(),
      new Set(),
    )
    expect(ranked.map((r) => r.filepath)).toEqual(['near.ts', 'far.ts'])
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('adds no proximity bonus for related/provided windows (proximity undefined)', () => {
    const [related] = rankContextWindows([mk({ source: 'related' })], new Set(), new Set())
    const [lspFar] = rankContextWindows(
      [mk({ source: 'related', proximity: 999 })],
      new Set(),
      new Set(),
    )
    expect(related.score).toBe(lspFar.score) // undefined vs a huge value → both contribute 0
  })
})

describe('packContextWindows', () => {
  const w = (filepath: string, content: string, score: number) => ({
    filepath,
    content,
    source: 'related' as const,
    recencyIndex: 0,
    score,
  })

  it('keeps highest-ranked first and drops the tail at the budget', () => {
    const kept = packContextWindows(
      [w('a', 'a'.repeat(100), 300), w('b', 'b'.repeat(100), 200), w('c', 'c'.repeat(100), 100)],
      150,
      10,
      1000,
    )
    expect(kept.map((k) => k.filepath)).toEqual(['a']) // 100 fits, 200 would exceed 150
  })

  it('honours maxWindows', () => {
    const kept = packContextWindows(
      [w('a', 'x', 3), w('b', 'y', 2), w('c', 'z', 1)],
      10000,
      2,
      1000,
    )
    expect(kept).toHaveLength(2)
  })

  it('clips each window to the per-window char cap', () => {
    const kept = packContextWindows([w('a', 'x'.repeat(50), 1)], 10000, 10, 10)
    expect(kept[0].content).toHaveLength(10)
  })

  it('a smaller lower-ranked window can still fit after a big one is skipped', () => {
    const kept = packContextWindows(
      [w('big', 'x'.repeat(100), 300), w('small', 'y'.repeat(5), 200)],
      20,
      10,
      1000,
    )
    expect(kept.map((k) => k.filepath)).toEqual(['small'])
  })

  it('reduces an oversized window to its cursor-relevant excerpt, not the head', () => {
    const content = [
      'import a',
      'import b',
      ...Array.from({ length: 40 }, (_, i) => `filler line ${i}`),
      'function relevantTarget(userInput) { return userInput }',
      ...Array.from({ length: 40 }, (_, i) => `tail ${i}`),
    ].join('\n')
    const kept = packContextWindows(
      [w('big.ts', content, 100)],
      10000,
      10,
      120,
      new Set(['relevantTarget', 'userInput']),
    )
    expect(kept[0].content).toContain('relevantTarget') // the relevant region survived
    expect(kept[0].content).not.toContain('import a') // NOT the head
    expect(kept[0].content.length).toBeLessThanOrEqual(120)
  })
})

describe('pickRelevantExcerpt', () => {
  const doc = (n: number, mark = -1) =>
    Array.from({ length: n }, (_, i) =>
      i === mark ? 'target userInput here' : `line ${i} padding text`,
    ).join('\n')

  it('returns the whole content when it already fits', () => {
    expect(pickRelevantExcerpt('short', new Set(['x']), 100)).toBe('short')
  })

  it('falls back to the head when there is no query bag', () => {
    const out = pickRelevantExcerpt(doc(50), new Set(), 40)
    expect(out).toBe(doc(50).slice(0, 40))
  })

  it('falls back to the head when nothing matches', () => {
    const out = pickRelevantExcerpt(doc(50), new Set(['nomatch']), 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.startsWith('line 0')).toBe(true)
  })

  it('windows around the best-matching line (deep in the file) and flags the elision', () => {
    const content = doc(60, 40) // "target userInput here" at line 40
    const out = pickRelevantExcerpt(content, new Set(['target', 'userInput']), 120)
    expect(out).toContain('target userInput here')
    expect(out).not.toContain('line 0 padding') // not the head
    expect(out.startsWith('…')).toBe(true) // elision hint (excerpt is not the file head)
    expect(out.length).toBeLessThanOrEqual(120)
  })
})

describe('formatEditEvents', () => {
  it('renders located, chronological, capped events', () => {
    const out = formatEditEvents([
      { lines: ['newest'], startLine: 10, endLine: 10 },
      { lines: ['older'], startLine: 3, endLine: 4 },
    ])
    // input is newest-first; output is chronological (older first)
    const older = out.indexOf('older')
    const newest = out.indexOf('newest')
    expect(older).toBeGreaterThanOrEqual(0)
    expect(older).toBeLessThan(newest)
    expect(out).toContain('(lines 3-4)')
    expect(out).toContain('(lines 10-10)')
  })

  it('omits the location when no line range is given', () => {
    const out = formatEditEvents([{ lines: ['x'] }])
    expect(out).toContain('--- edit 1 ---')
    expect(out).not.toContain('lines')
  })

  it('drops blank events and returns empty for none', () => {
    expect(formatEditEvents([{ lines: ['   '] }])).toBe('')
    expect(formatEditEvents([])).toBe('')
  })

  it('keeps only the newest MAX_EVENT_COUNT (6)', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({ lines: [`e${i}`] }))
    const out = formatEditEvents(events)
    // newest 6 are e0..e5 (input newest-first); e6,e7,e8 dropped
    expect(out).not.toContain('e6')
    expect(out).toContain('e0')
    expect(out).toContain('e5')
  })

  it('renders a before→after DIFF (with -/+ lines) when `before` is supplied', () => {
    const out = formatEditEvents([
      {
        before: ['const x = 1', 'return x'],
        lines: ['const x = 2', 'return x'],
        startLine: 1,
        endLine: 2,
      },
    ])
    expect(out).toContain('--- edit 1 (lines 1-2) diff ---')
    expect(out).toContain('-const x = 1')
    expect(out).toContain('+const x = 2')
    expect(out).toContain(' return x') // unchanged suffix kept as context
  })

  it('falls back to the plain window when before === after (no diff)', () => {
    const out = formatEditEvents([{ before: ['same'], lines: ['same'] }])
    expect(out).toContain('--- edit 1 ---') // no " diff" tag
    expect(out).not.toContain(' diff ---')
    expect(out).toContain('same')
  })
})

describe('formatEditDiff', () => {
  it('trims common prefix/suffix and marks the changed middle', () => {
    const out = formatEditDiff(['a', 'b', 'c'], ['a', 'B', 'c'])
    expect(out).toBe(' a\n-b\n+B\n c')
  })

  it('handles pure insertion (no removed lines)', () => {
    const out = formatEditDiff(['a', 'c'], ['a', 'b', 'c'])
    expect(out).toBe(' a\n+b\n c')
  })

  it('returns null for identical input', () => {
    expect(formatEditDiff(['x', 'y'], ['x', 'y'])).toBeNull()
  })

  it('returns null (fallback) for a pathologically large window', () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`)
    expect(formatEditDiff(big, big.slice(1))).toBeNull()
  })
})

describe('estimateTokens / renderWindowGroup', () => {
  it('estimates ~chars/4', () => {
    expect(estimateTokens('12345678')).toBe(2)
  })
  it('renders labeled path blocks', () => {
    const out = renderWindowGroup([
      { filepath: 'a.ts', content: 'AAA', source: 'related', recencyIndex: 0, score: 1 },
      { filepath: 'b.ts', content: 'BBB', source: 'lsp', recencyIndex: 0, score: 1 },
    ])
    expect(out).toBe('--- a.ts ---\nAAA\n\n--- b.ts ---\nBBB')
  })
})
