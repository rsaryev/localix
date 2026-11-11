import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * One material behind the window, nothing painted under or over it.
 *
 * macOS gives a window one `NSVisualEffectView` (`window_material.rs`); the page lies clear over it
 * and only content panes carry a coat. Three ways this went wrong before, each cheap to catch:
 *
 *  1. A painted backdrop. The root carried a wallpaper of radial colour pools wherever the native
 *     material was missing (browser, Windows, Linux), so translucent coats faked glass over a
 *     picture. Apple: "Reduce your use of custom backgrounds ... let the system determine the
 *     background appearance" (Adopting Liquid Glass). Where there is no material the ground is solid.
 *  2. Glass on glass. Menus, popovers and dialogs blurred the page with CSS `backdrop-filter`, a
 *     second frost over the system's. Floating surfaces are solid with a hairline.
 *  3. A dead accessibility switch. WKWebView never matches `prefers-reduced-transparency` (probed on
 *     macOS 26: neither `reduce` nor `no-preference` matches), so a rule keyed on it never ran in the
 *     app. The shell stamps `data-reduce-transparency` instead (`display_options.rs`).
 */

const REPO_ROOT = new URL('../', import.meta.url).pathname

/** The files that own the window's ground and its floating materials. */
const WINDOW_FILES = [
  'packages/kit/styles/window-material.css',
  'packages/kit/styles/materials.css',
] as const

/** Every kit stylesheet the desktop page loads; the dead media query is banned in all of them. */
const KIT_STYLES = [
  ...WINDOW_FILES,
  'packages/kit/styles/utilities.css',
  'packages/kit/styles/accessibility.css',
  'packages/kit/styles/effects.css',
] as const

const FLOATING = /\.(?:lx-floating-surface|lx-modal-surface|bg-popover)\b/u
const BLUR = /backdrop-filter\s*:\s*[^;]*blur\(/u
const DEAD_QUERY = /prefers-reduced-transparency/u

interface Rule {
  readonly selector: string
  readonly body: string
}

/** Innermost `selector { declarations }` pairs; an at-rule wrapper's own brace is skipped. */
function rules(css: string): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//gu, '')
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }))
}

function read(path: string): string {
  return readFileSync(REPO_ROOT + path, 'utf8')
}

export function paintedBackdrops(css: string): string[] {
  return rules(css)
    .filter((rule) => /gradient\(/u.test(rule.body))
    .map((rule) => rule.selector)
}

export function frostedFloats(css: string): string[] {
  return rules(css)
    .filter((rule) => FLOATING.test(rule.selector) && BLUR.test(rule.body))
    .map((rule) => rule.selector)
}

export function deadQueries(css: string): number {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '').match(new RegExp(DEAD_QUERY, 'gu'))?.length ?? 0
}

describe('window glass', () => {
  test('the window ground paints no picture', () => {
    expect(paintedBackdrops(read('packages/kit/styles/window-material.css'))).toEqual([])
  })

  test('menus, popovers and dialogs do not frost the page under them', () => {
    expect(WINDOW_FILES.flatMap((path) => frostedFloats(read(path)))).toEqual([])
  })

  test('no kit rule waits on a media query WKWebView never matches', () => {
    expect(KIT_STYLES.map((path) => [path, deadQueries(read(path))])).toEqual(
      KIT_STYLES.map((path) => [path, 0]),
    )
  })
})

describe('the detectors fire on planted defects', () => {
  test('a gradient on the root', () => {
    expect(paintedBackdrops(':root { background: radial-gradient(red, blue); }')).toEqual([':root'])
  })

  test('a blurred popover inside an at-rule', () => {
    expect(
      frostedFloats('@supports (x: y) { :root .bg-popover { backdrop-filter: blur(24px); } }'),
    ).toEqual([':root .bg-popover'])
  })

  test('the dead query, but not in a comment', () => {
    expect(
      deadQueries(
        '/* prefers-reduced-transparency */ @media (prefers-reduced-transparency: reduce) {}',
      ),
    ).toBe(1)
  })
})
