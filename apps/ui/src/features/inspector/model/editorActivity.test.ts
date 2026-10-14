import { describe, expect, test } from 'bun:test'
import {
  mergeEditedRanges,
  recordEdit,
  getFileEditHistory,
  sliceLines,
  type EditedRange,
} from './editorActivity'

// 10-line doc "l0..l9".
const doc = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`).join('\n')
const TTL = 2 * 60 * 1000

// A prior edited window fixture. `before` defaults to `lines` (no-change baseline).
const er = (
  o: Partial<EditedRange> &
    Pick<EditedRange, 'filepath' | 'startLine' | 'endLine' | 'lines' | 'ts'>,
): EditedRange => ({ before: o.lines, ...o })

describe('mergeEditedRanges', () => {
  test('captures a ±2-line window around the edited line + the pre-edit baseline', () => {
    const prev = doc(10) // "l0..l9"
    const next = ['l0', 'l1', 'l2', 'l3', 'l4', 'CHANGED', 'l6', 'l7', 'l8', 'l9'].join('\n')
    const r = mergeEditedRanges([], 'a.ts', prev, next, 5, 1000)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ filepath: 'a.ts', startLine: 3, endLine: 7, ts: 1000 })
    expect(r[0].lines).toEqual(['l3', 'l4', 'CHANGED', 'l6', 'l7'])
    expect(r[0].before).toEqual(['l3', 'l4', 'l5', 'l6', 'l7']) // pre-edit window
  })

  test('folds an overlapping same-file window into a widened span, PRESERVING the origin before', () => {
    const existing: EditedRange[] = [
      er({
        filepath: 'a.ts',
        startLine: 3,
        endLine: 7,
        before: ['orig'],
        lines: ['l3', 'l4', 'l5', 'l6', 'l7'],
        ts: 1000,
      }),
    ]
    const r = mergeEditedRanges(existing, 'a.ts', doc(10), doc(10), 8, 1100) // window [6,9] overlaps [3,7]
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ startLine: 3, endLine: 9, ts: 1100 })
    expect(r[0].lines).toEqual(['l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'])
    expect(r[0].before).toEqual(['orig']) // origin snapshot kept across the burst
  })

  test('does NOT fold a different FILE (a different path is a distinct window)', () => {
    const existing: EditedRange[] = [
      er({ filepath: 'b.ts', startLine: 3, endLine: 7, lines: ['x'], ts: 1000 }),
    ]
    const r = mergeEditedRanges(existing, 'a.ts', doc(10), doc(10), 5, 1100)
    expect(r).toHaveLength(2)
    expect(r.map((e) => e.filepath)).toEqual(['a.ts', 'b.ts'])
  })

  test('drops entries past the TTL relative to `now`', () => {
    const stale: EditedRange[] = [
      er({ filepath: 'b.ts', startLine: 0, endLine: 2, lines: ['x'], ts: 1000 }),
    ]
    const r = mergeEditedRanges(stale, 'a.ts', doc(10), doc(10), 5, 1000 + TTL + 1)
    expect(r.map((e) => e.filepath)).toEqual(['a.ts']) // stale b.ts evicted
  })

  test('keeps a non-overlapping same-file window AND caps at MAX_EDITED=3, newest first', () => {
    const now = 5000
    const existing: EditedRange[] = ['c.ts', 'd.ts', 'e.ts'].map((f) =>
      er({ filepath: f, startLine: 0, endLine: 2, lines: ['x'], ts: now }),
    )
    const r = mergeEditedRanges(existing, 'a.ts', doc(10), doc(10), 5, now)
    expect(r.map((e) => e.filepath)).toEqual(['a.ts', 'c.ts', 'd.ts']) // new first, e.ts trimmed by the cap
  })
})

describe('sliceLines', () => {
  const docs = ['', '\n', 'a', 'a\n', 'a\nb', 'a\nb\n', 'a\n\nb\n\n', doc(10), doc(1)]

  test('matches split-and-slice for every window, including past both ends', () => {
    for (const content of docs) {
      for (let start = -1; start <= 12; start++) {
        for (let end = start - 1; end <= 12; end++) {
          expect(sliceLines(content, start, end)).toEqual(
            start < 0 || end < start ? [] : content.split('\n').slice(start, end + 1),
          )
        }
      }
    }
  })
})

/** The pre-optimization implementation, kept verbatim as the behavioural oracle. */
function referenceMerge(
  edited: EditedRange[],
  filepath: string,
  prevContent: string,
  content: string,
  line: number,
  now: number,
): EditedRange[] {
  const radius = 2
  const ttl = TTL
  const allLines = content.split('\n')
  const winStart = Math.max(0, line - radius)
  const winEnd = Math.min(allLines.length - 1, line + radius)
  let startLine = winStart
  let endLine = winEnd
  const prevLines = prevContent.split('\n')
  let before: string[] = prevLines.slice(winStart, winEnd + 1)
  const rest = edited.filter((e) => {
    if (now - e.ts >= ttl) return false
    if (e.filepath === filepath && e.startLine <= winEnd && winStart <= e.endLine) {
      startLine = Math.min(startLine, e.startLine)
      endLine = Math.max(endLine, e.endLine)
      before = e.before
      return false
    }
    return true
  })
  endLine = Math.min(endLine, allLines.length - 1)
  return [
    {
      filepath,
      startLine,
      endLine,
      before,
      lines: allLines.slice(startLine, endLine + 1),
      ts: now,
    },
    ...rest,
  ].slice(0, 3)
}

describe('mergeEditedRanges stays identical to the split-based original', () => {
  const prior = (o: Partial<EditedRange> = {}): EditedRange =>
    er({ filepath: 'a.ts', startLine: 3, endLine: 7, lines: ['x'], ts: 1000, ...o })

  const cases: { name: string; prev: string; next: string; line: number; edited: EditedRange[] }[] =
    [
      {
        name: 'single-character insert mid-document',
        prev: doc(10),
        next: doc(10).replace('l5', 'l5x'),
        line: 5,
        edited: [],
      },
      { name: 'insert on the first line', prev: doc(10), next: doc(10), line: 0, edited: [] },
      { name: 'insert on the last line', prev: doc(10), next: doc(10), line: 9, edited: [] },
      {
        name: 'newline at the end of the document',
        prev: doc(3),
        next: `${doc(3)}\n`,
        line: 3,
        edited: [],
      },
      {
        name: 'paste replacing a selection (document grows)',
        prev: doc(10),
        next: doc(40),
        line: 12,
        edited: [],
      },
      {
        name: 'paste deleting most of the document (window past the new end)',
        prev: doc(40),
        next: doc(3),
        line: 30,
        edited: [],
      },
      { name: 'empty document', prev: '', next: '', line: 0, edited: [] },
      {
        name: 'fold widening on both sides',
        prev: doc(20),
        next: doc(20),
        line: 10,
        edited: [prior({ startLine: 6, endLine: 14 })],
      },
      {
        name: 'fold widening past the document end',
        prev: doc(10),
        next: doc(10),
        line: 8,
        edited: [prior({ startLine: 7, endLine: 40 })],
      },
      {
        name: 'fold on a shrunken document',
        prev: doc(40),
        next: doc(4),
        line: 30,
        edited: [prior({ startLine: 20, endLine: 35 })],
      },
      {
        name: 'multiple overlapping windows + a stale one + another file',
        prev: doc(20),
        next: doc(20),
        line: 9,
        edited: [
          prior({ startLine: 8, endLine: 11, before: ['origin'] }),
          prior({ startLine: 5, endLine: 9, before: ['older'] }),
          prior({ filepath: 'b.ts', startLine: 0, endLine: 2, ts: 1 }),
          prior({ filepath: 'c.ts', startLine: 0, endLine: 2 }),
        ],
      },
    ]

  for (const c of cases) {
    test(c.name, () => {
      const now = 2000
      expect(mergeEditedRanges(c.edited, 'a.ts', c.prev, c.next, c.line, now)).toEqual(
        referenceMerge(c.edited, 'a.ts', c.prev, c.next, c.line, now),
      )
    })
  }

  test('a multi-cursor edit records ONE window, at the first edited line', () => {
    // FileTab attributes the event to `primaryChangeLine` (the lowest delta line); the
    // recorded window is the ±2 window around it, exactly as a single edit there.
    const next = doc(40)
    expect(mergeEditedRanges([], 'a.ts', doc(40), next, 8, 2000)).toEqual(
      referenceMerge([], 'a.ts', doc(40), next, 8, 2000),
    )
  })

  test('an external update landing between keystrokes still diffs against the old text', () => {
    const prev = doc(10)
    const external = ['l0', 'l1', 'AGENT', 'l3', 'l4'].join('\n')
    const r = mergeEditedRanges([], 'a.ts', prev, external, 2, 2000)
    expect(r[0].lines).toEqual(['l0', 'l1', 'AGENT', 'l3', 'l4'])
    expect(r[0].before).toEqual(['l0', 'l1', 'l2', 'l3', 'l4'])
    expect(r).toEqual(referenceMerge([], 'a.ts', prev, external, 2, 2000))
  })
})

describe('recordEdit / getFileEditHistory', () => {
  test('records an edit and returns it (with before) keyed by exact path', () => {
    recordEdit('/root/.localix/workspace/LOCALIX-1/quicksort.ts', doc(10), doc(10), 5)
    const hist = getFileEditHistory('/root/.localix/workspace/LOCALIX-1/quicksort.ts')
    expect(hist).toHaveLength(1)
    expect(hist[0]).toMatchObject({ startLine: 4, endLine: 8 }) // 1-based
    expect(Array.isArray(hist[0].before)).toBe(true)
  })

  test('history is keyed by exact path — a same-name file in another sandbox never matches', () => {
    recordEdit('/root/.localix/workspace/LOCALIX-1/dup.ts', doc(10), doc(10), 5)
    expect(getFileEditHistory('/root/.localix/workspace/LOCALIX-1/dup.ts')).toHaveLength(1)
    expect(getFileEditHistory('/root/.localix/workspace/LOCALIX-1001/dup.ts')).toHaveLength(0)
  })
})
