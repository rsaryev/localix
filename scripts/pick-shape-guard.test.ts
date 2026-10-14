/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  withPlantedSources,
  type Exemptions,
} from '../apps/api/src/lib/source-lint'

/**
 * A PICK IS A MENU ROW, NOT A HAND-DRAWN ONE.
 *
 * The defect: every picker drew "one of these" its own way. Radix radio items with their own
 * indicator, a popover radio group, a `DropdownMenuItem` with a `<Check>` placed by hand, a
 * described menu whose options were `checked` rows (a checkbox — announced as a multi-select,
 * and back then drawn with a leading check that took the option's icon) compared against the
 * current value. The same mode looked four ways in four
 * menus, and spacing, colour and keyboard behaviour drifted between them. The kit's answer is one:
 * `MenuEntries` rows with `selected` (icon kept, ✓ at the end, `menuitemradio`) — see
 * docs/extending/ui-kit.md, "One look for a menu row that can be chosen". The kit itself OWNS the primitives these shapes are built from,
 * so it is the one tree not scanned.
 *
 * The failure is an inconsistency, and an inconsistency passes every behaviour test: the picker
 * works, it just is not the app's picker. So this reads the source.
 *
 * A RATCHET. The offenders that existed when the rule was written are pinned below as recorded
 * debt (keyed by file AND shape), and are being converted. A NEW offender fails at once; a pinned
 * one that disappears is reported by the stale test (see `STRICT_STALE`).
 */

const REPO_ROOT = path.resolve(import.meta.dir, '..')

/** Every UI source outside the kit: the workbench, the plugin views, the SDK's own components. */
const INCLUDE = [
  'apps/ui/src/**/*.{ts,tsx}',
  'plugins/*/ui/**/*.{ts,tsx}',
  'packages/plugin-sdk/src/ui/**/*.{ts,tsx}',
]

const skip = (file: string) => /\.test\.|\/testing\//.test(file)

/** The four shapes of a hand-built pick, each a detector over comment-stripped code. */
const SHAPES = {
  /** Radix's radio item draws its own leading dot/check, not the menu's trailing one. */
  'radio-item': (code: string) => /\bDropdownMenuRadioItem\b/.test(code),
  /** A popover radio group is a form control set inside chrome. */
  'popover-radio': (code: string) => /\bPopover(?:RadioItem|RadioGroup)\b/.test(code),
  /** A check placed by hand inside a menu item: its own geometry, beside the kit's. */
  'hand-check': (code: string) => handPlacedCheck(code),
  /** A single choice described as `checked` rows: announced as a multi-select it is not. */
  'checked-compare': (code: string) => /\bchecked:\s*[^,\n}]*?===/.test(code),
} as const

type Shape = keyof typeof SHAPES

/**
 * A `<Check` (or `<CheckIcon`) between a menu item's opening tag and its closing tag.
 *
 * Not the "Copied" feedback a copy command swaps its glyph to (`copied ? <Check/> : <Copy/>`):
 * that check marks an act that just happened, not the chosen one of a list.
 */
function handPlacedCheck(code: string): boolean {
  const open = /<(DropdownMenuItem|DropdownMenuRadioItem)\b/g
  for (const match of code.matchAll(open)) {
    const close = code.indexOf(`</${match[1]}>`, match.index)
    if (close < 0) continue
    const body = code.slice(match.index, close).replace(/\bcopied\s*\?\s*<Check\b/g, '')
    if (/<Check(?:Icon)?[\s/>]/.test(body)) return true
  }
  return false
}

/**
 * The blessed shapes. The debt pinned when the rule landed has been converted; what remains are
 * legitimate exceptions, keyed by file AND shape so a second hand-built pick in the same file is
 * still caught. A converted debt entry is not re-added here — a new one is a fix, not a blessing.
 */
const BASELINE: Exemptions = {
  // The board's colour picker is a swatch GRID, not a list of rows — the check is drawn INSIDE
  // the chosen swatch, where a menu row's trailing check has no place to go. Its option picker in
  // the same file is `MenuEntries` `selected` rows.
  [exemptionKey('plugins/project-space/ui/board/pickers.tsx', 'hand-check')]: {
    reason: 'Board colour swatch grid marks the chosen swatch inside the swatch itself.',
  },
}

/**
 * Whether a pinned offender that disappeared FAILS the suite. On: the conversions have landed, so
 * an exemption whose offender is gone is a blessing nobody needs, and leaving it would let the same
 * shape come back in that file unnoticed. The ledger ratchets like `source-size-guard`.
 */
const STRICT_STALE = true

/** Every hand-built pick under `root`, as `file::shape` keys. */
async function pickOffenders(root: string, minFiles: number): Promise<string[]> {
  const files = await scanSources({ root, include: INCLUDE, skip, minFiles })
  const found: string[] = []
  for (const { file, code } of files) {
    for (const shape of Object.keys(SHAPES) as Shape[]) {
      if (SHAPES[shape](code)) found.push(exemptionKey(file, shape))
    }
  }
  return found.sort()
}

/** Pinned exemptions whose offender no longer exists in `found`. */
function staleKeys(found: readonly string[]): string[] {
  const present = new Set(found)
  return Object.keys(BASELINE).filter((key) => !present.has(key))
}

describe('pick shape', () => {
  test('the scan reaches the menus it polices', async () => {
    const files = await scanSources({ root: REPO_ROOT, include: INCLUDE, skip, minFiles: 100 })
    // ANTI-VOID on the subject, not just the files: if the walk stopped reaching menus, an empty
    // offender list would look like a converted tree.
    const menus = files.filter(({ code }) => /\b(?:MenuEntries|DropdownMenuItem)\b/.test(code))
    assertNotVoid('menu built with MenuEntries or DropdownMenuItem', menus.length)
  })

  test('no NEW hand-built pick outside the kit', async () => {
    const { offenders } = auditExemptions(BASELINE, await pickOffenders(REPO_ROOT, 100))
    expect(
      offenders.map(
        (key) =>
          `${key} — build the pick from MenuEntries rows with \`selected\` (docs/extending/ui-kit.md, "One look for a menu row that can be chosen")`,
      ),
    ).toEqual([])
  })

  test('converted offenders leave the baseline', async () => {
    const stale = staleKeys(await pickOffenders(REPO_ROOT, 100))
    if (!STRICT_STALE) {
      if (stale.length > 0)
        console.warn(
          `pick-shape: ${stale.length} pinned offender(s) are gone:\n  ${stale.join('\n  ')}`,
        )
      return
    }
    expect(stale).toEqual([])
  })

  test('positive control: an exemption whose offender is gone is reported stale', async () => {
    // A tree without the swatch grid: its pinned exemption must surface, or the ratchet is void.
    const found = await withPlantedSources(
      { 'apps/ui/src/x/Clean.tsx': 'export const A = 1\n' },
      (root) => pickOffenders(root, 1),
    )
    expect(staleKeys(found)).toEqual(Object.keys(BASELINE))
  })

  const planted: Record<Shape, string> = {
    'radio-item': `export const A = () => <DropdownMenuRadioItem value="a">A</DropdownMenuRadioItem>\n`,
    'popover-radio': `export const A = () => <PopoverRadioGroup value="a" />\n`,
    'hand-check': `export const A = ({ on }) => (\n  <DropdownMenuItem>\n    A\n    {on && <Check className="ml-auto" />}\n  </DropdownMenuItem>\n)\n`,
    'checked-compare': `export const rows = modes.map((mode) => ({ id: mode, checked: mode === current, onSelect }))\n`,
  }

  for (const shape of Object.keys(planted) as Shape[]) {
    test(`positive control: ${shape} is caught, and commented out it is not`, async () => {
      await assertPositiveControl({
        subject: `a hand-built pick (${shape})`,
        // Nested, so a walk that stopped recursing is caught too.
        file: 'apps/ui/src/features/deep/nested/Picker.tsx',
        offender: planted[shape],
        detect: async (root) =>
          (await pickOffenders(root, 1)).filter((key) => key.endsWith(`::${shape}`)),
      })
    })
  }

  test('the kit row recipe is not an offender', async () => {
    // A `selected` row and a real multi-select toggle are the shapes the rule asks for.
    const clean = `export const rows = [\n  { id: 'a', label: 'A', selected: mode === 'a', onSelect },\n  { id: 'b', label: 'B', checked: enabled, onSelect },\n]\n`
    const found = await withPlantedSources({ 'apps/ui/src/x/Clean.tsx': clean }, (root) =>
      pickOffenders(root, 1),
    )
    expect(found).toEqual([])
  })
})
