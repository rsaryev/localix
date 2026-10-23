/**
 * Every mini app that mounts DOM in its tests runs them under the kit's preload.
 *
 * The defect: Radix freezes its layout-effect hook when its module is FIRST evaluated, and a portal
 * built on a no-op hook never mounts — every dialog, popover and menu in the process renders
 * nothing, with no error. `packages/kit/test-preload.ts` cures that once by evaluating Radix under
 * a temporary DOM. The root `bunfig.toml` preloads it, but a mini app's own `bun test .` (its
 * `test` script, what turbo runs) reads only the mini app's `bunfig.toml`. A mini app without that
 * chain passed for as long as nothing imported Radix at module scope — until the kit test harness
 * (`@localixai/kit/testing`) gained a static path to the tooltip, and ten database and five
 * trading dialog/menu suites went blank at once.
 *
 * So the rule is checked where it is cheap: a mini app with a `*.dom.test.tsx` declares a
 * `bunfig.toml` whose preload runs the deadline first and the kit preload before anything of its
 * own. Copying the warm-up into a mini app preload is not the fix — that is how three copies
 * drifted.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const WORKSPACE_ROOTS = ['apps', 'plugins']
const DEADLINE = '../../scripts/test-deadline.ts'
const KIT_PRELOAD = '../../packages/kit/test-preload.ts'
const UI_PRELOAD = './src/testing/preload.ts'

/** What is wrong with a mini app's `bunfig.toml` text, or `[]` when its preload chain is right. */
export function preloadViolations(bunfig: string | undefined): string[] {
  if (bunfig === undefined) return ['no bunfig.toml, so `bun test .` runs without the kit preload']
  const parsed = Bun.TOML.parse(bunfig) as { test?: { preload?: unknown } }
  const raw = parsed.test?.preload
  const preload = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const problems: string[] = []
  if (preload[0] !== DEADLINE) problems.push(`[test].preload must start with ${DEADLINE}`)
  // apps/ui warms Radix synchronously in its own preload, which also works under `--isolate`.
  const kit = preload.findIndex((entry) => entry === KIT_PRELOAD || entry === UI_PRELOAD)
  if (kit === -1) problems.push(`[test].preload must include ${KIT_PRELOAD}`)
  else if (preload.slice(1, kit).some((entry) => entry !== DEADLINE))
    problems.push(`${KIT_PRELOAD} must run before the mini app's own preload`)
  return problems
}

const hasDomTests = (dir: string): boolean => {
  const glob = new Bun.Glob('**/*.dom.test.tsx')
  for (const path of glob.scanSync({ cwd: dir, onlyFiles: true })) {
    if (!path.includes('node_modules/') && !path.startsWith('dist/')) return true
  }
  return false
}

describe('mini app test preload', () => {
  test('the detector rejects a missing file, a missing kit preload and a wrong order', () => {
    expect(preloadViolations(undefined)).toHaveLength(1)
    expect(preloadViolations(`[test]\npreload = ["${DEADLINE}", "./test-preload.ts"]`)).toEqual([
      `[test].preload must include ${KIT_PRELOAD}`,
    ])
    expect(
      preloadViolations(`[test]\npreload = ["${DEADLINE}", "./test-preload.ts", "${KIT_PRELOAD}"]`),
    ).toEqual([`${KIT_PRELOAD} must run before the mini app's own preload`])
    expect(preloadViolations(`[test]\npreload = ["${KIT_PRELOAD}"]`)).toEqual([
      `[test].preload must start with ${DEADLINE}`,
    ])
    expect(
      preloadViolations(`[test]\npreload = ["${DEADLINE}", "${KIT_PRELOAD}", "./test-preload.ts"]`),
    ).toEqual([])
  })

  test('every app and mini app with DOM tests chains the kit preload', () => {
    const offenders: string[] = []
    for (const owner of WORKSPACE_ROOTS) {
      for (const entry of readdirSync(join(ROOT, owner), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(ROOT, owner, entry.name)
        if (!hasDomTests(dir)) continue
        const file = join(dir, 'bunfig.toml')
        const text = existsSync(file) ? readFileSync(file, 'utf8') : undefined
        for (const problem of preloadViolations(text))
          offenders.push(`${owner}/${entry.name}: ${problem}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
