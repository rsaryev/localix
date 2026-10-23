import { describe, expect, test } from 'bun:test'
import { changedLines, evaluate, ratchet } from './gates.mjs'

const lines = (entries: [number, number][]) => new Map(entries)

/** Two packages: `a` runs 3 of its 4 lines, `b` runs 1 of 2; `b/never.ts` is loaded by no test. */
const coverage = new Map([
  [
    'pkg/a/x.ts',
    lines([
      [1, 1],
      [2, 1],
      [3, 0],
      [4, 2],
    ]),
  ],
  [
    'pkg/b/y.ts',
    lines([
      [1, 1],
      [2, 0],
    ]),
  ],
])
const sources = {
  'pkg/a': ['pkg/a/x.ts'],
  'pkg/b': ['pkg/b/y.ts', 'pkg/b/never.ts'],
}

describe('package floors', () => {
  test('a package at or above its floor passes and one below it fails', () => {
    const result = evaluate({
      coverage,
      sources,
      baseline: { floors: { 'pkg/a': 75, 'pkg/b': 60 }, unloaded: ['pkg/b/never.ts'] },
    })

    expect(result.packages).toEqual([
      {
        pkg: 'pkg/a',
        covered: 3,
        total: 4,
        percent: 75,
        floor: 75,
        uncovered: 1,
        maxUncovered: null,
        firstLoaded: 0,
        ok: true,
      },
      {
        pkg: 'pkg/b',
        covered: 1,
        total: 2,
        percent: 50,
        floor: 60,
        uncovered: 1,
        maxUncovered: null,
        firstLoaded: 0,
        ok: false,
      },
    ])
    expect(result.ok).toBe(false)
  })

  // Deleting dead code that tests covered lowers a package's percentage without adding a single
  // untested line; the floor must not punish that. More untested lines still fail.
  test('below its floor, a package passes while its untested lines have not grown', () => {
    const baseline = {
      floors: { 'pkg/a': 90, 'pkg/b': 0 },
      uncovered: { 'pkg/a': 1 },
      unloaded: ['pkg/b/never.ts'],
    }
    const result = evaluate({ coverage, sources, baseline })
    expect(result.packages[0]).toMatchObject({ percent: 75, floor: 90, uncovered: 1, ok: true })

    const grown = evaluate({
      coverage: new Map([...coverage, ['pkg/a/z.ts', lines([[1, 0]])]]),
      sources: { ...sources, 'pkg/a': ['pkg/a/x.ts', 'pkg/a/z.ts'] },
      baseline,
    })
    expect(grown.packages[0]).toMatchObject({ uncovered: 2, maxUncovered: 1, ok: false })
  })

  test('a package with tests but no recorded floor fails until a floor is recorded', () => {
    const result = evaluate({
      coverage,
      sources,
      baseline: { floors: { 'pkg/a': 70 }, unloaded: ['pkg/b/never.ts'] },
    })

    expect(result.packages.find((row) => row.pkg === 'pkg/b')).toMatchObject({
      floor: null,
      ok: false,
    })
  })
})

// A first test for a file no test loaded brings that file's untested lines into the count. That is
// coverage gained, not lost: those lines count against the ceiling from the next recording on.
test('a file a test loads for the first time does not count against the untested ceiling', () => {
  const baseline = {
    floors: { 'pkg/a': 90, 'pkg/b': 0 },
    uncovered: { 'pkg/a': 1, 'pkg/b': 1 },
    unloaded: ['pkg/a/x.ts', 'pkg/b/never.ts'],
  }
  const result = evaluate({
    coverage: new Map([
      ...coverage,
      [
        'pkg/a/old.ts',
        lines([
          [1, 1],
          [2, 0],
        ]),
      ],
    ]),
    sources: { ...sources, 'pkg/a': ['pkg/a/x.ts', 'pkg/a/old.ts'] },
    baseline,
  })
  // x.ts is newly loaded with 1 untested line; old.ts keeps the 1 the ceiling allows.
  expect(result.packages[0]).toMatchObject({ uncovered: 2, maxUncovered: 1, ok: true })
})

describe('files no test loads', () => {
  test('a new source file that no test loads fails', () => {
    const result = evaluate({
      coverage,
      sources,
      baseline: { floors: { 'pkg/a': 0, 'pkg/b': 0 }, unloaded: [] },
    })

    expect(result.unloaded).toEqual({ added: ['pkg/b/never.ts'], stale: [] })
    expect(result.ok).toBe(false)
  })

  test('a listed file that a test now loads must leave the list, so it only shrinks', () => {
    const result = evaluate({
      coverage,
      sources,
      baseline: { floors: { 'pkg/a': 0, 'pkg/b': 0 }, unloaded: ['pkg/b/never.ts', 'pkg/a/x.ts'] },
    })

    expect(result.unloaded).toEqual({ added: [], stale: ['pkg/a/x.ts'] })
    expect(result.ok).toBe(false)
  })

  test('a listed file that was deleted must leave the list too', () => {
    const result = evaluate({
      coverage,
      sources,
      baseline: {
        floors: { 'pkg/a': 0, 'pkg/b': 0 },
        unloaded: ['pkg/b/never.ts', 'pkg/b/gone.ts'],
      },
    })

    expect(result.unloaded.stale).toEqual(['pkg/b/gone.ts'])
  })
})

describe('changed lines', () => {
  test('reads the new-side line numbers of every hunk', () => {
    const diff = `diff --git a/pkg/a/x.ts b/pkg/a/x.ts
--- a/pkg/a/x.ts
+++ b/pkg/a/x.ts
@@ -1,0 +2,2 @@
+one
+two
@@ -9 +12 @@
-old
+new
diff --git a/gone.ts b/gone.ts
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
`
    expect(changedLines(diff)).toEqual(new Map([['pkg/a/x.ts', [2, 3, 12]]]))
  })

  test('the changed lines that tests can run must reach the threshold', () => {
    const result = evaluate({
      coverage,
      sources,
      baseline: { floors: { 'pkg/a': 0, 'pkg/b': 0 }, unloaded: ['pkg/b/never.ts'] },
      // Line 9 of x.ts holds no statement, so it does not count.
      changed: new Map([['pkg/a/x.ts', [2, 3, 9]]]),
      diffThreshold: 80,
    })

    expect(result.diff).toEqual({
      covered: 1,
      total: 2,
      percent: 50,
      threshold: 80,
      uncovered: { 'pkg/a/x.ts': [3] },
      unloaded: [],
      ok: false,
    })
  })

  test('a changed file that no test loads fails the diff whatever the percentage', () => {
    const result = evaluate({
      coverage,
      sources,
      baseline: { floors: { 'pkg/a': 0, 'pkg/b': 0 }, unloaded: ['pkg/b/never.ts'] },
      changed: new Map([
        ['pkg/b/never.ts', [1]],
        ['README.md', [1]],
      ]),
      diffThreshold: 80,
    })

    expect(result.diff).toMatchObject({ total: 0, unloaded: ['pkg/b/never.ts'], ok: false })
  })
})

describe('ratchet', () => {
  test('floors rise to what was measured and never fall; the unloaded list only shrinks', () => {
    const measured = evaluate({
      coverage,
      sources,
      baseline: {
        floors: { 'pkg/a': 80, 'pkg/b': 10 },
        unloaded: ['pkg/b/never.ts', 'pkg/a/x.ts'],
      },
    })

    expect(
      ratchet(
        { floors: { 'pkg/a': 80, 'pkg/b': 10 }, unloaded: ['pkg/b/never.ts', 'pkg/a/x.ts'] },
        measured,
      ),
    ).toEqual({
      floors: { 'pkg/a': 80, 'pkg/b': 50 },
      uncovered: { 'pkg/a': 1, 'pkg/b': 1 },
      unloaded: ['pkg/b/never.ts'],
    })
  })

  test('a recording takes in the untested lines of files a test loaded for the first time', () => {
    const baseline = {
      floors: { 'pkg/a': 90, 'pkg/b': 0 },
      uncovered: { 'pkg/a': 1, 'pkg/b': 1 },
      unloaded: ['pkg/a/x.ts', 'pkg/b/never.ts'],
    }
    const measured = evaluate({
      coverage: new Map([
        ...coverage,
        [
          'pkg/a/old.ts',
          lines([
            [1, 1],
            [2, 0],
          ]),
        ],
      ]),
      sources: { ...sources, 'pkg/a': ['pkg/a/x.ts', 'pkg/a/old.ts'] },
      baseline,
    })
    const next = ratchet(baseline, measured)
    expect(next.uncovered['pkg/a']).toBe(2)
    expect(next.unloaded).toEqual(['pkg/b/never.ts'])
    // Recorded, the same measurement passes.
    expect(
      evaluate({
        coverage: new Map([
          ...coverage,
          [
            'pkg/a/old.ts',
            lines([
              [1, 1],
              [2, 0],
            ]),
          ],
        ]),
        sources: { ...sources, 'pkg/a': ['pkg/a/x.ts', 'pkg/a/old.ts'] },
        baseline: next,
      }).packages[0]?.ok,
    ).toBe(true)
  })

  test('the untested-lines ceiling only falls', () => {
    const measured = evaluate({
      coverage,
      sources,
      baseline: { floors: {}, uncovered: { 'pkg/a': 0, 'pkg/b': 5 }, unloaded: ['pkg/b/never.ts'] },
    })
    expect(
      ratchet(
        { floors: {}, uncovered: { 'pkg/a': 0, 'pkg/b': 5 }, unloaded: ['pkg/b/never.ts'] },
        measured,
      ).uncovered,
    ).toEqual({ 'pkg/a': 0, 'pkg/b': 1 })
  })

  test('a first recording takes what is measured, including the files no test loads yet', () => {
    const measured = evaluate({ coverage, sources, baseline: { floors: {}, unloaded: [] } })

    expect(ratchet({ floors: {}, unloaded: [] }, measured, { adopt: true })).toEqual({
      floors: { 'pkg/a': 75, 'pkg/b': 50 },
      uncovered: { 'pkg/a': 1, 'pkg/b': 1 },
      unloaded: ['pkg/b/never.ts'],
    })
  })
})
