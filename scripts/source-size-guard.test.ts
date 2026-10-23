import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Repo-wide ratchet against god-files.
 *
 * The layering rule this repo works by — small, focused modules; an orchestrator
 * imports many sub-200-line neighbours instead of growing — is enforced nowhere,
 * and the codebase currently carries ~290 source files past 300 lines. Rewriting
 * them wholesale would be churn for its own sake, so this guard is a RATCHET, not
 * a purge: every current offender is pinned in `source-size-baseline.json` at its
 * present size, and the suite fails only when
 *
 *   1. a NEW file crosses the limit (it was born too big — split it),
 *   2. a pinned file GROWS materially past its pinned size (it is getting worse), or
 *   3. a pinned file shrinks under the limit / disappears but keeps its pin
 *      (the baseline must ratchet DOWN, so the list stays an honest debt ledger,
 *      never a permanent allowlist).
 *
 * Shrinking a pinned file re-pins it at the smaller size via the regen command
 * below. Growing one is what the guard exists to stop.
 *
 * Regenerate after deliberate splits:  bun scripts/source-size-guard.test.ts --regen
 * (regen only lowers pins and drops resolved entries; it never raises a pin —
 * raising one is a review decision, made by editing the JSON by hand.)
 */

const repoRoot = resolve(import.meta.dir, '..')
const BASELINE_PATH = resolve(repoRoot, 'scripts/source-size-baseline.json')

/** A file longer than this is a split candidate; new ones may not be born past it. */
const MAX_LINES = 300
/**
 * Stylesheets get their own, looser limit — a rule block is shorter than a function, so a
 * surface's CSS legitimately runs longer than its module. Loose is not absent: the plugin whose
 * worst file was a 4380-line stylesheet had every one of its `.tsx` files pinned while the CSS,
 * invisible to a `.ts`-only ratchet, was the file nobody could review.
 */
const MAX_STYLE_LINES = 500
/** A pinned offender may drift this much before the ratchet bites (comment churn). */
const GROWTH_ALLOWANCE = 0.1

const limitFor = (path: string): number => (path.endsWith('.css') ? MAX_STYLE_LINES : MAX_LINES)

// `apps/landing/src` was outside this list until it was not: the ratchet never
// saw the marketing site, so a 555-line docs page and a 660-line stylesheet grew
// there with nothing to notice. Every app that ships TypeScript belongs here.
// The Tauri shell's Rust sources follow the same layering rule; `*_tests.rs` companions are
// table-driven coverage, measured like `.test.ts` files (not at all).
const ROOTS = [
  'apps/api/src',
  'apps/ui/src',
  'apps/landing/src',
  'apps/desktop-tauri/src-tauri/src',
  'packages',
  'mini-apps',
  'plugins',
]
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '__snapshots__',
  'migrations',
  // Emitted by scripts/build-docs.mjs. Its size tracks how many docs pages
  // exist, not how the code is layered, so pinning it would make adding a
  // guide fail this ratchet.
  'generated',
])

function isSource(name: string): boolean {
  if (name.endsWith('.css')) return true
  if (name.endsWith('.rs')) return !name.endsWith('_tests.rs')
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false
  // Tests and typings measure differently: a long test file is table-driven
  // coverage, not an architecture smell, and .d.ts is generated shape.
  return !/\.(test|spec|dom\.test)\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (isSource(entry)) out.push(full)
  }
  return out
}

function countLines(file: string): number {
  const text = readFileSync(file, 'utf8')
  // Trailing newline does not open a line; an empty file has zero.
  if (text.length === 0) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

/**
 * Only src-plane files inside package/plugin workspaces; skips their configs.
 *
 * `styles/` is a source plane too: the app's style layers moved from `apps/ui/src/app/styles`
 * (measured, as all of `apps/`) to `packages/kit/styles`, and a plane list without it would have
 * let the move take every stylesheet out of the ratchet.
 */
function inMeasuredPlane(repoPath: string): boolean {
  if (repoPath.startsWith('apps/')) return true
  return /^(packages|mini-apps|plugins)\/[^/]+\/(src|backend|frontend|ui|styles)\//.test(repoPath)
}

function measure(): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const root of ROOTS) {
    for (const file of walk(resolve(repoRoot, root))) {
      const repoPath = relative(repoRoot, file)
      if (!inMeasuredPlane(repoPath)) continue
      sizes.set(repoPath, countLines(file))
    }
  }
  return sizes
}

function loadBaseline(): Record<string, number> {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>
}

if (process.argv.includes('--regen')) {
  const sizes = measure()
  const prior = (() => {
    try {
      return loadBaseline()
    } catch {
      return {}
    }
  })()
  const next: Record<string, number> = {}
  for (const [path, lines] of [...sizes].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines <= limitFor(path)) continue
    const pinned = prior[path]
    // Never raise a pin silently: keep the stricter of (old pin, current size).
    next[path] = pinned === undefined ? lines : Math.min(pinned, lines)
  }
  await Bun.write(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
  console.log(
    `pinned ${Object.keys(next).length} offenders to ${relative(repoRoot, BASELINE_PATH)}`,
  )
} else {
  describe('source size ratchet', () => {
    const sizes = measure()
    const baseline = loadBaseline()

    test('no new file is born past the limit', () => {
      const newOffenders = [...sizes]
        .filter(([path, lines]) => lines > limitFor(path) && baseline[path] === undefined)
        .map(
          ([path, lines]) =>
            `${path} (${lines} lines, limit ${limitFor(path)}) — split it or, with a reviewed reason, pin it in source-size-baseline.json`,
        )
      expect(newOffenders).toEqual([])
    })

    test('no pinned offender grows materially past its pin', () => {
      const grown = [...sizes]
        .filter(([path, lines]) => {
          const pinned = baseline[path]
          return pinned !== undefined && lines > Math.ceil(pinned * (1 + GROWTH_ALLOWANCE))
        })
        .map(
          ([path, lines]) =>
            `${path} grew ${lines} > pin ${baseline[path]} (+${GROWTH_ALLOWANCE * 100}%) — shrink it back or split it`,
        )
      expect(grown).toEqual([])
    })

    test('the baseline ratchets down: resolved offenders leave the ledger', () => {
      const stale = Object.keys(baseline)
        .filter((path) => (sizes.get(path) ?? 0) <= limitFor(path))
        .map(
          (path) =>
            `${path} is now ${sizes.get(path) ?? 'deleted'} lines — run: bun scripts/source-size-guard.test.ts --regen`,
        )
      expect(stale).toEqual([])
    })
  })
}
