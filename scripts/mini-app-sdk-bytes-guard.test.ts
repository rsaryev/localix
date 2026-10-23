import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fixtureDist, measure, type Measured, measureSubpaths } from './mini-app-sdk-bytes'

/**
 * A byte budget on every public subpath of `@localixai/mini-app-sdk`.
 *
 * ~50k lines of mini app UI import this SDK, and its cost is invisible from the inside: the build
 * is a plain `tsc`, so nothing reports what a subpath weighs, and the `./ui` barrel re-exports 166
 * names from across the tree. Two regressions hide in that shape, and a type-check sees neither:
 *
 *   1. a subpath quietly grows — someone hangs a heavy module off a barrel eleven mini apps import;
 *   2. a subpath stops being TREE-SHAKEABLE. Today `import { CSV_CONTENT_TYPE } from '…/ui'` costs
 *      40 bytes out of a 57 KB barrel. One top-level side effect in a module along that chain, or
 *      one `sideEffects: false` dropped from the manifest, and that single import starts dragging
 *      the whole barrel into every mini app bundle. Nothing else in this repo would notice.
 *
 * The measurement is a real bundle (see `mini-app-sdk-bytes.ts`) and the numbers are pinned in
 * `mini-app-sdk-bytes-baseline.json`, in the same ratchet shape as `source-size-guard.test.ts`: a pin
 * may fall, may drift 10%, and may not rise without a reviewed edit.
 *
 * For each re-export-only barrel the probe runs twice — the whole namespace, then a single named
 * export — and the single import must stay a fraction of the whole. That ratio is the proof
 * tree-shaking still works, and it is the one rule here that regenerating cannot make green.
 *
 * The guard needs `dist`, which is a build artifact, so it BUILDS it when absent or stale rather
 * than skipping: a skipped budget reports clean, and the fresh clone with no `dist` is exactly where
 * an unmeasured subpath would live longest. Nothing here needs a positive control planted by hand —
 * a measurement that started reading nothing would read far BELOW every pin, which is the
 * ratchet-down failure below.
 *
 * Regenerate after a deliberate change:  bun scripts/mini-app-sdk-bytes-guard.test.ts --regen
 */

const BASELINE_PATH = resolve(import.meta.dir, 'mini-app-sdk-bytes-baseline.json')

/** A subpath past this is not born, whatever the baseline says. Raising it is a review decision. */
const MAX_SUBPATH_BYTES = 64 * 1024
/** Minifier churn between Bun releases moves these numbers a little; a regression moves them a lot. */
const DRIFT_ALLOWANCE = 0.1
/** A single named import costing this much of its barrel is not being shaken out of it. */
const SHAKEABLE_FRACTION = 0.5

interface Pin {
  readonly bytes: number
  readonly shake?: { readonly export: string; readonly bytes: number }
}

function loadBaseline(): Record<string, Pin> {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, Pin>
  } catch {
    return {}
  }
}

const baseline = loadBaseline()
const measured = await measureSubpaths((subpath) => baseline[subpath]?.shake?.export)
const pinOf = (subpath: string): Pin | undefined => baseline[subpath]
const grewPast = (bytes: number, pin: number): boolean =>
  bytes > Math.ceil(pin * (1 + DRIFT_ALLOWANCE))

if (process.argv.includes('--regen')) {
  const next: Record<string, Pin> = {}
  const ordered = [...measured].sort((a, b) => a.subpath.localeCompare(b.subpath))
  for (const { subpath, bytes, shake } of ordered) {
    next[subpath] = shake === undefined ? { bytes } : { bytes, shake }
  }
  await Bun.write(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
  const total = measured.reduce((sum, entry) => sum + entry.bytes, 0)
  console.log(`pinned ${measured.length} subpaths (${total} bytes of first-party output)`)
} else {
  describe('mini-app-sdk subpath byte budgets', () => {
    test('every subpath is pinned to a budget', () => {
      const unpinned = measured
        .filter(({ subpath }) => pinOf(subpath) === undefined)
        .map(
          ({ subpath, bytes }) =>
            `${subpath} is published but has no budget (measured ${bytes} bytes). Publishing a ` +
            'subpath is a deliberate act, so record what it costs: ' +
            'bun scripts/mini-app-sdk-bytes-guard.test.ts --regen',
        )
      expect(unpinned).toEqual([])
    })

    test('no subpath outgrows its budget', () => {
      const over = measured
        .filter(({ subpath, bytes }) => {
          const pin = pinOf(subpath)
          return pin !== undefined && grewPast(bytes, pin.bytes)
        })
        .map(({ subpath, bytes }) => {
          const budget = pinOf(subpath)?.bytes ?? 0
          const grew = Math.round((bytes / budget - 1) * 100)
          return (
            `${subpath}: budget ${budget} bytes, now ${bytes} bytes (+${grew}%, allowance ` +
            `${DRIFT_ALLOWANCE * 100}%). Every mini app importing this subpath pays it. Move the new ` +
            'weight behind its own subpath, or — if the growth is the point — regenerate the ' +
            'baseline in the same commit so a reviewer sees the number change.'
          )
        })
      expect(over).toEqual([])
    })

    test('no subpath is born past the ceiling', () => {
      const huge = measured
        .filter(({ bytes }) => bytes > MAX_SUBPATH_BYTES)
        .map(
          ({ subpath, bytes }) =>
            `${subpath} is ${bytes} bytes, past the ${MAX_SUBPATH_BYTES}-byte ceiling. Split it into ` +
            'subpaths a consumer can choose between, or raise the ceiling deliberately and say why.',
        )
      expect(huge).toEqual([])
    })

    test('the baseline ratchets down: a shrunk or retired subpath re-pins', () => {
      const stale = [
        ...measured
          .filter(({ subpath, bytes }) => {
            const pin = pinOf(subpath)
            return pin !== undefined && bytes < Math.floor(pin.bytes * (1 - DRIFT_ALLOWANCE))
          })
          .map(
            ({ subpath, bytes }) =>
              `${subpath} now costs ${bytes} bytes against a budget of ${pinOf(subpath)?.bytes} — ` +
              'take the win: bun scripts/mini-app-sdk-bytes-guard.test.ts --regen',
          ),
        ...Object.keys(baseline)
          .filter((subpath) => !measured.some((entry) => entry.subpath === subpath))
          .map(
            (subpath) =>
              `${subpath} is budgeted but no longer published — drop the pin: ` +
              'bun scripts/mini-app-sdk-bytes-guard.test.ts --regen',
          ),
      ]
      expect(stale).toEqual([])
    })

    test('a single named import still shakes out of every barrel', () => {
      const barrels = measured.filter((entry) => entry.shake !== undefined)
      // Anti-void: `./ui` and `./backend` are the barrels this rule exists for. If they stop being
      // recognised as barrels, the list below is empty and the assertion passes on nothing.
      const names = barrels.map(({ subpath }) => subpath)
      expect(names).toContain('./ui')
      expect(names).toContain('./backend')

      const dragged = barrels
        .filter(({ bytes, shake }) => (shake?.bytes ?? bytes) > bytes * SHAKEABLE_FRACTION)
        .map(
          ({ subpath, bytes, shake }) =>
            `${subpath}: importing { ${shake?.export} } alone costs ${shake?.bytes} of the barrel's ` +
            `${bytes} bytes — over ${SHAKEABLE_FRACTION * 100}%, so it is no longer being shaken ` +
            'out. Look for a new top-level side effect in the modules it re-exports, or a lost ' +
            '`sideEffects: false` in packages/mini-app-sdk/package.json.',
        )
      expect(dragged).toEqual([])
    })

    test('the single-import cost of a barrel is pinned too', () => {
      const drifted = measured
        .filter(({ subpath, shake }: Measured) => {
          const pin = pinOf(subpath)?.shake
          return shake !== undefined && pin !== undefined && grewPast(shake.bytes, pin.bytes)
        })
        .map(
          ({ subpath, shake }) =>
            `${subpath}: { ${shake?.export} } alone cost ${pinOf(subpath)?.shake?.bytes} bytes and ` +
            `now costs ${shake?.bytes} — something in the barrel's graph stopped being free to ` +
            'import. Find out what before regenerating.',
        )
      expect(drifted).toEqual([])
    })

    test('the measurement fails loudly rather than reading zero', async () => {
      const fixture = fixtureDist()
      try {
        const entry = join(fixture, 'dist/ui/index.js')
        await expect(measure(fixture, './ui', entry, 'notExportedByTheBarrel')).rejects.toThrow(
          /No matching export/u,
        )
      } finally {
        rmSync(fixture, { recursive: true, force: true })
      }
    })
  })
}
