import { describe, expect, test } from 'bun:test'

/**
 * ONE menu, everywhere.
 *
 * A right-click menu is the surface a user judges an editor's polish by, and the app has exactly
 * one: `packages/kit/src/overlays/context-menu.tsx` over `POPOVER_SURFACE`/`MENU_ITEM`, with
 * the dropdown family as its click-triggered twin. Nothing about that is enforced by the type system —
 * a feature or a plugin can reach past it to Radix and get a menu that is *almost* the app's, or
 * transcribe the danger recipe into a `className` and get an item that is *almost* the app's
 * destructive item. Both happened, in both directions, before this file existed: three separate
 * spellings of the delete row, and an API-plugin context menu whose Delete had no tint at all while
 * the dropdown beside it did.
 *
 * Two rules, both cheap to satisfy and impossible to satisfy accidentally:
 *
 *  1. Only the primitive imports Radix's menu families. Everyone else imports the app's.
 *  2. A destructive item declares `tone="danger"`. The token recipe lives in `popover-surface.ts`
 *     and tints the highlight too, which a bare `text-status-error` never did.
 *
 * The positive controls at the bottom are what make a green run mean something: every rule here is
 * also satisfied by a scanner that reads nothing, so each detector is run against a planted defect
 * and the test fails if it stays quiet.
 */

const REPO_ROOT = new URL('../', import.meta.url).pathname

/** Where a menu can legitimately be built. Everything under these roots is scanned. */
const SOURCE_ROOTS = ['apps/ui/src', 'plugins', 'packages'] as const

/** The two files that ARE the app's menus, and so are the only ones allowed to import Radix's. */
const PRIMITIVE_OWNERS = new Set([
  'packages/kit/src/overlays/context-menu.tsx',
  'packages/kit/src/overlays/dropdown-menu.tsx',
])

/** `import { ContextMenu as … } from 'radix-ui'` — the reach past the app's own primitive. */
const RADIX_MENU_IMPORT =
  /import\s*\{[^}]*\b(?:ContextMenu|DropdownMenu)\b[^}]*\}\s*from\s*['"](?:radix-ui|@radix-ui\/[^'"]+)['"]/u

/**
 * A menu item carrying the danger colour in its class string rather than through `tone`.
 *
 * Anchored on the opening tag so the match is a real menu item and not any nearby element that
 * happens to be red — a row's own `text-status-error` label is none of this file's business. The
 * `[^>]*` walk stops at the tag's own `>`, and menu items never nest a tag inside their opening
 * element, so it cannot run past into a sibling.
 */
const HAND_ROLLED_DANGER_ITEM =
  /<(?:ContextMenu|DropdownMenu)(?:Item|CheckboxItem|SubTrigger)\b[^>]*className=\{?["'][^"'}]*text-(?:status-error|destructive)/u

/**
 * A submenu's panel, and whether it is portalled.
 *
 * Rendered inline, Radix puts `SubContent` INSIDE the parent panel — and the parent panel is
 * `overflow-y-auto overscroll-contain`, so the submenu was clipped to its box: invisible in the
 * dropdown family, and mispositioned in both, because a clipped element also loses the collision
 * measurements Radix flips a side on. Both families shipped that way at once, which is exactly the
 * kind of shared defect this file exists to keep from coming back.
 */
function subContentIsPortalled(source: string): boolean {
  const start = source.indexOf('SubContent = React.forwardRef')
  if (start < 0) return false
  const body = source.slice(start, source.indexOf('displayName', start))
  // The JSX `<` is what separates the rendered element from the `typeof …Primitive.SubContent`
  // in the forwardRef's type arguments, which names the same symbol two lines above it.
  const panel = body.search(/<\w+Primitive\.SubContent\b/u)
  const portal = body.search(/<\w+Primitive\.Portal\b/u)
  return panel >= 0 && portal >= 0 && portal < panel
}

interface Offence {
  readonly path: string
  readonly line: number
  readonly text: string
}

function scan(source: string, rule: RegExp): number[] {
  return source
    .split('\n')
    .map((line, index) => (rule.test(line) ? index + 1 : 0))
    .filter((lineNumber) => lineNumber > 0)
}

/**
 * A menu item's props can wrap across lines, so the danger rule reads a small window rather than
 * one line. Joining the whole file instead would let one item's `<` reach into the next item's
 * `className`, which is the false positive this shape avoids.
 */
function scanOpeningTags(source: string, rule: RegExp): number[] {
  const lines = source.split('\n')
  const hits: number[] = []
  for (const [index, line] of lines.entries()) {
    if (!/<(?:ContextMenu|DropdownMenu)(?:Item|CheckboxItem|SubTrigger)\b/u.test(line)) continue
    // The tag ends at the first `>` at or after this line; six lines covers every item in the repo.
    const window = lines.slice(index, index + 6).join(' ')
    const tag = window.slice(0, window.indexOf('>') + 1 || window.length)
    if (rule.test(tag)) hits.push(index + 1)
  }
  return hits
}

async function sourceFiles(): Promise<string[]> {
  const paths: string[] = []
  for (const root of SOURCE_ROOTS) {
    for (const path of new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: `${REPO_ROOT}/${root}` })) {
      if (path.includes('node_modules') || path.includes('/dist/')) continue
      if (/\.(?:test|spec)\.tsx?$/u.test(path)) continue
      paths.push(`${root}/${path}`)
    }
  }
  return paths.sort()
}

function report(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.path}:${o.line} — ${o.text.trim()}`).join('\n')
}

describe('menu surface guard', () => {
  test('only the app primitives import Radix menu families', async () => {
    const offences: Offence[] = []
    for (const path of await sourceFiles()) {
      if (PRIMITIVE_OWNERS.has(path)) continue
      const source = await Bun.file(`${REPO_ROOT}/${path}`).text()
      const lines = source.split('\n')
      for (const line of scan(source, RADIX_MENU_IMPORT)) {
        offences.push({ path, line, text: lines[line - 1] ?? '' })
      }
    }
    expect(report(offences)).toBe('')
  })

  test('destructive menu items declare tone="danger" instead of transcribing the recipe', async () => {
    const offences: Offence[] = []
    for (const path of await sourceFiles()) {
      const source = await Bun.file(`${REPO_ROOT}/${path}`).text()
      const lines = source.split('\n')
      for (const line of scanOpeningTags(source, HAND_ROLLED_DANGER_ITEM)) {
        offences.push({ path, line, text: lines[line - 1] ?? '' })
      }
    }
    expect(report(offences)).toBe('')
  })

  test('every menu family portals its submenu panel', async () => {
    const offences: string[] = []
    for (const path of PRIMITIVE_OWNERS) {
      const source = await Bun.file(`${REPO_ROOT}/${path}`).text()
      if (!subContentIsPortalled(source)) offences.push(`${path} — SubContent is not portalled`)
    }
    expect(offences.join('\n')).toBe('')
  })

  test('positive control: each detector reports its planted defect', () => {
    const plantedRadixImport = `import { ContextMenu } from 'radix-ui'\n`
    expect(scan(plantedRadixImport, RADIX_MENU_IMPORT)).toEqual([1])

    const plantedInlineDanger = `<ContextMenuItem className="text-status-error" onSelect={drop}>\n`
    expect(scanOpeningTags(plantedInlineDanger, HAND_ROLLED_DANGER_ITEM)).toEqual([1])

    const plantedWrappedDanger = [
      '<DropdownMenuItem',
      '  onSelect={onDelete}',
      '  className="text-status-error focus:text-status-error"',
      '>',
    ].join('\n')
    expect(scanOpeningTags(plantedWrappedDanger, HAND_ROLLED_DANGER_ITEM)).toEqual([1])

    const plantedInlineSubContent = [
      'const DropdownMenuSubContent = React.forwardRef<X, Y>((props, ref) => (',
      '  <DropdownMenuPrimitive.SubContent ref={ref} {...props} />',
      '))',
      'DropdownMenuSubContent.displayName = "x"',
    ].join('\n')
    expect(subContentIsPortalled(plantedInlineSubContent)).toBe(false)
    expect(
      subContentIsPortalled(
        plantedInlineSubContent.replace(
          '  <DropdownMenuPrimitive.SubContent ref={ref} {...props} />',
          [
            '  <DropdownMenuPrimitive.Portal>',
            '    <DropdownMenuPrimitive.SubContent ref={ref} {...props} />',
            '  </DropdownMenuPrimitive.Portal>',
          ].join('\n'),
        ),
      ),
    ).toBe(true)

    // …and stays quiet on the shapes it must not claim: the sanctioned `tone`, and a red label
    // that merely sits inside a menu item.
    expect(
      scanOpeningTags('<ContextMenuItem tone="danger" onSelect={drop}>\n', HAND_ROLLED_DANGER_ITEM),
    ).toEqual([])
    expect(
      scanOpeningTags(
        '<ContextMenuItem onSelect={drop}>\n  <span className="text-status-error">3 failed</span>\n',
        HAND_ROLLED_DANGER_ITEM,
      ),
    ).toEqual([])
  })
})
