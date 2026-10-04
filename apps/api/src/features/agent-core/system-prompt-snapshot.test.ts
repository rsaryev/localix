import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderGoldenMatrix, fullPrompt } from './testing/prompt-harness'
import { buildBackgroundJobsSection } from './system-prompt-sections'
import { resolveRunProfile } from './run-shape'

// Golden-file harness: renders the full {profile × tools} system-prompt
// matrix into committed, human-readable `__prompts__/*.txt` files. Reviewing those
// files IS reviewing the assembled prompt as a whole. Any drift fails CI; regenerate
// intentionally with `UPDATE_PROMPTS=1 bun test system-prompt-snapshot`.
//
// FALSIFIABILITY — prompt text is BEHAVIOR that no ordinary test covers, so this guard
// has to be able to go red on every way it can be evaded, not just on a changed byte:
//
//   1. CHANGED golden  → compared below.
//   2. MISSING golden  → RED. It used to be silently (re)written and PASS, so deleting a
//      golden, or RENAMING a matrix key, voided the guard instead of failing it: the old
//      file was orphaned, a fresh one was minted from whatever the code now says, and a
//      prompt change rode along invisibly. Writing now happens ONLY under UPDATE_PROMPTS
//      — which is already the documented way to accept a prompt change.
//   3. ORPHANED golden → RED (see the stale-entry test). An allowlist with no stale check
//      rots into a file nobody renders and nobody reads.
//   4. EMPTY matrix    → RED. `for (…of renderGoldenMatrix())` registers ZERO tests if the
//      harness ever returns {}, and zero tests is a green suite. The count is asserted.
const DIR = join(import.meta.dir, '__prompts__')
const UPDATE = process.env.UPDATE_PROMPTS === '1'

function golden(name: string, content: string): void {
  const file = join(DIR, `${name}.txt`)
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(file, content)
    return
  }
  if (!existsSync(file)) {
    throw new Error(
      `MISSING golden __prompts__/${name}.txt — a new or renamed prompt is not reviewed until its golden is committed (regen with UPDATE_PROMPTS=1).`,
    )
  }
  const expected = readFileSync(file, 'utf8')
  expect(content === expected ? 'match' : `DRIFT in ${name} (regen with UPDATE_PROMPTS=1)`).toBe(
    'match',
  )
}

/** Every golden this suite is responsible for: the matrix, plus the fixed-`now` sections. */
const EXTRA_GOLDENS = ['section-background-jobs'] as const

describe('system-prompt golden matrix', () => {
  const matrix = renderGoldenMatrix()

  // Load-bearing: without it, a harness that renders nothing produces no tests, and a
  // suite with no tests is green. The exact number is deliberately NOT asserted — that
  // would just be a second golden to update — but zero is always a bug.
  test('the matrix renders a non-empty set of prompts', () => {
    expect(Object.keys(matrix).length).toBeGreaterThan(0)
  })

  for (const [name, prompt] of Object.entries(matrix)) {
    test(`golden: ${name}`, () => golden(name, prompt))
  }

  // Sections that stamp a live age use Date.now() at render time — lock them with a
  // fixed `now` so the golden stays deterministic (the matrix omits them for this reason).
  test('golden: section-background-jobs', () => {
    const section = buildBackgroundJobsSection(
      [
        {
          jobId: 'job-1',
          command: 'npm run dev',
          startedAt: 0,
          output: 'listening on :3000',
          running: true,
        },
      ],
      { canManage: true },
      120_000,
    )
    golden('section-background-jobs', section ?? '(null)')
  })

  // The stale-entry half. A committed golden that nothing renders any more is a prompt
  // nobody reviews and a reviewer's false sense of coverage — the same rot an allowlist
  // grows without one. (`_known_dups.json` belongs to the dedup guard, not to this one.)
  test('no orphaned goldens — every committed __prompts__ file is still rendered', () => {
    const rendered = new Set<string>([...Object.keys(matrix), ...EXTRA_GOLDENS])
    const committed = readdirSync(DIR)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => f.slice(0, -'.txt'.length))
    expect(committed.filter((name) => !rendered.has(name))).toEqual([])
  })
})

// A persona REPLACES the identity slot; nothing rewrites what the user wrote.
describe('system-prompt identity slot', () => {
  test('an agent persona is used verbatim and leads the prompt', () => {
    const persona = 'You are Custom Persona, an artisanal assistant.'
    const wl = fullPrompt('orchestrator', {
      agentProfile: resolveRunProfile({ sessionKind: 'chat' }, { prompt: persona }),
    })
    expect(wl.startsWith(persona)).toBe(true)
    // The shipped line it replaced is gone, not appended around.
    expect(wl.split('\n', 1)[0]).not.toContain('Localix Agent')
  })
})
