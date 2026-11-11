import { describe, expect, test } from 'bun:test'

/**
 * Raised surfaces are cut from one recipe, and controls on the window are fills, not outlines.
 *
 * The rules are in docs/internals/visual-system.md, "Surfaces over the window". Three ways they
 * drifted before this file existed, each cheap to catch exactly:
 *
 *  1. A caller re-edged a raised surface. Dialogs, the pane dialog, the confirmation and the picker
 *     sheet each added their own `border-control-border` (and sometimes a `ring-1`) on top of the
 *     recipe, so the same material showed two edges in one place and one in another. The recipe
 *     (`popover-surface.ts`, `modal-surface.ts`) owns the edge; a `cn()` that composes a recipe
 *     adds geometry, never another edge.
 *  2. A raised surface frosted the page. A sticky header and a chart tooltip painted `bg-popover`
 *     with `backdrop-blur`: glass on glass, which the window's own rule already refuses in CSS.
 *  3. The fill ladder inverted. A field's resting fill was a 9% veil and its hover a 7% one, so
 *     hovering a field made it lighter than at rest. Every ink step is a density in
 *     `window-material.css`, and they must climb: rest < hover < pressed < selected.
 *
 * Each detector is also run on a planted defect, so a scanner that reads nothing cannot pass.
 */

const REPO_ROOT = new URL('../', import.meta.url).pathname
const SOURCE_ROOTS = ['apps/ui/src', 'packages'] as const

/** The files that define the recipes, and so are where the edge is allowed to be written. */
const RECIPE_OWNERS = new Set([
  'packages/kit/src/overlays/popover-surface.ts',
  'packages/kit/src/overlays/modal-surface.ts',
])

const RECIPE = /\b(?:modalSurface|POPOVER_MATERIAL|POPOVER_SURFACE|FLOATING_SURFACE)\b/u
/** An edge class: a border or ring of any side or colour, as a whole class token. */
const EDGE =
  /(?:^|[\s'"`])(?:border(?:-[trblxy])?|ring(?:-\d+)?|border-control-border|ring-foreground\/\d+)(?=[\s'"`]|$)/u
const RAISED_FILL =
  /\b(?:bg-popover|lx-floating-surface|lx-modal-surface)\b|\b(?:POPOVER_\w+|modalSurface|FLOATING_SURFACE)\b/u
const FROST = /\bbackdrop-blur\b/u

/** The source of every `cn(…)` call, balanced on parentheses, with the line it starts on. */
function cnCalls(source: string): { line: number; text: string }[] {
  const calls: { line: number; text: string }[] = []
  for (const match of source.matchAll(/\bcn\(/gu)) {
    let depth = 0
    let end = match.index
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++
      else if (source[end] === ')' && --depth === 0) break
    }
    const text = source
      .slice(match.index, end + 1)
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/u, ''))
      .join('\n')
    calls.push({ line: source.slice(0, match.index).split('\n').length, text })
  }
  return calls
}

export function reEdgedSurfaces(source: string): number[] {
  return cnCalls(source)
    .filter((call) => RECIPE.test(call.text) && EDGE.test(call.text))
    .map((call) => call.line)
}

export function frostedSurfaces(source: string): number[] {
  return source
    .split('\n')
    .map((line, index) => (RAISED_FILL.test(line) && FROST.test(line) ? index + 1 : 0))
    .filter((line) => line > 0)
}

const LADDER = ['fill', 'hover', 'active', 'selection'] as const

/** Each theme's ink densities, in ladder order, read from its `:root[data-theme=…]` block. */
export function inkLadders(css: string): Record<string, number[]> {
  const ladders: Record<string, number[]> = {}
  for (const block of css.matchAll(/:root\[data-theme='(\w+)'\]\s*\{([^}]*)\}/gu)) {
    const body = block[2] ?? ''
    ladders[block[1] ?? ''] = LADDER.map((step) =>
      Number(new RegExp(`--${step}-density:\\s*([\\d.]+)%`, 'u').exec(body)?.[1] ?? Number.NaN),
    )
  }
  return ladders
}

const climbs = (steps: number[]) =>
  steps.every((value, index) => index === 0 || value > steps[index - 1]!)

async function sourceFiles(): Promise<string[]> {
  const paths: string[] = []
  for (const root of SOURCE_ROOTS) {
    for (const path of new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: `${REPO_ROOT}/${root}` })) {
      if (path.includes('node_modules') || path.includes('/dist/')) continue
      if (/\.(?:test|spec|structure)\.tsx?$|\.dom\.test\.tsx?$/u.test(path)) continue
      paths.push(`${root}/${path}`)
    }
  }
  return paths.sort()
}

async function offences(detect: (source: string) => number[], skip = new Set<string>()) {
  const found: string[] = []
  for (const path of await sourceFiles()) {
    if (skip.has(path)) continue
    const source = await Bun.file(`${REPO_ROOT}/${path}`).text()
    for (const line of detect(source)) found.push(`${path}:${line}`)
  }
  return found
}

describe('raised surfaces', () => {
  test('a caller composing a surface recipe adds no edge of its own', async () => {
    expect(await offences(reEdgedSurfaces, RECIPE_OWNERS)).toEqual([])
  })

  test('no raised surface frosts what is under it', async () => {
    expect(await offences(frostedSurfaces)).toEqual([])
  })

  test('the ink fills climb: rest < hover < pressed < selected, in both themes', async () => {
    const css = await Bun.file(`${REPO_ROOT}/packages/kit/styles/window-material.css`).text()
    const ladders = inkLadders(css)
    expect(Object.keys(ladders).sort()).toEqual(['dark', 'light'])
    for (const [theme, steps] of Object.entries(ladders)) {
      expect({ theme, steps, climbs: climbs(steps) }).toEqual({ theme, steps, climbs: true })
    }
  })
})

describe('the detectors fire on planted defects', () => {
  test('a dialog re-edged across lines, but not a header inside it', () => {
    const planted = [
      'className={cn(',
      '  modalSurface,',
      "  'rounded-xl border border-control-border', // the edge",
      ')}',
      "<div className={cn('flex border-t border-border-soft')} />",
    ].join('\n')
    expect(reEdgedSurfaces(planted)).toEqual([1])
    expect(reEdgedSurfaces("cn(POPOVER_MATERIAL, 'rounded-t-2xl')")).toEqual([])
    expect(reEdgedSurfaces("cn(FLOATING_SURFACE, 'ring-1 ring-foreground/10')")).toEqual([1])
  })

  test('a frosted popover fill', () => {
    expect(frostedSurfaces("'sticky top-0 bg-popover backdrop-blur'")).toEqual([1])
    expect(frostedSurfaces("'sticky top-0 bg-background backdrop-blur'")).toEqual([])
  })

  test('an inverted ladder', () => {
    const css =
      ":root[data-theme='dark'] { --fill-density: 9%; --hover-density: 7%; --active-density: 11%; --selection-density: 13%; }"
    expect(inkLadders(css)).toEqual({ dark: [9, 7, 11, 13] })
    expect(climbs([9, 7, 11, 13])).toBe(false)
  })
})
