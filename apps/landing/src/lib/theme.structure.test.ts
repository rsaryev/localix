import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const landingDir = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(landingDir, rel), 'utf8')

describe('landing theme', () => {
  const css = read('src/styles.css')

  // The kit's window material paints a blue-violet gradient behind a translucent ground, which
  // is right for the app window and made the whole marketing page navy. A page that stops
  // declaring its own opaque ground silently falls back to it.
  test.each(['dark', 'light'])('the %s theme opts out of the window material', (theme) => {
    const block = new RegExp(
      `:root:root:root\\[data-site='landing'\\]\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`,
    ).exec(css)?.[1]
    expect(block).toBeDefined()
    expect(block).toContain('--window-backdrop: none')
    expect(block).toContain('--work-density: 100%')
    expect(block).toMatch(/--window-ground: #[0-9a-f]{6}/)
  })

  test('the deep black and the classic light grounds are the documented ones', () => {
    expect(css).toContain('--window-ground: #070707')
    expect(css).toContain('--window-ground: #fafafa')
  })

  // The theme must be settled before the first paint and the static markup must carry the
  // attribute the overrides select on, or the page flashes the wrong theme (or the material).
  test('index.html chooses the theme before paint and marks the site', () => {
    const html = read('index.html')
    expect(html).toContain('data-site="landing"')
    expect(html).toContain("localStorage.getItem('localix-theme')")
    expect(html).toContain('prefers-color-scheme: light')
    expect(html.indexOf("localStorage.getItem('localix-theme')")).toBeLessThan(
      html.indexOf('<div id="root">'),
    )
  })

  // Both icons render and CSS picks one: choosing an icon in React from the live theme would make
  // the prerendered markup differ from the hydrated one.
  test('the toggle never branches on the live theme while rendering', () => {
    const source = read('src/components/ThemeToggle.tsx')
    expect(source).toContain('dark:block')
    expect(source).toContain('dark:hidden')
    expect(source.split('export function ThemeToggle')[1]).not.toContain('dataset.theme')
  })
})
