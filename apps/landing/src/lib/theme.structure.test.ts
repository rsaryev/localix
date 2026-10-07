import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

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
    expect(html).not.toContain('localStorage')
    expect(html).toContain('prefers-color-scheme: light')
    expect(html.indexOf('applySystemTheme()')).toBeLessThan(html.indexOf('<div id="root">'))
  })

  test('the site has no manual theme control', () => {
    expect(read('src/components/SiteLayout.tsx')).not.toContain('ThemeToggle')
  })

  test.each([false, true])('system light=%s is applied and reacts to changes', (light) => {
    const script = read('index.html').match(/<script>([\s\S]*?)<\/script>/u)?.[1]
    expect(script).toBeDefined()
    const root = { dataset: { theme: 'dark' }, style: { colorScheme: 'dark' } }
    let change: (() => void) | undefined
    const media = {
      matches: light,
      addEventListener(event: string, listener: () => void) {
        expect(event).toBe('change')
        change = listener
      },
    }
    runInNewContext(script!, {
      document: { documentElement: root },
      matchMedia(query: string) {
        expect(query).toBe('(prefers-color-scheme: light)')
        return media
      },
      localStorage: {
        getItem() {
          throw new Error('System theme must not depend on saved preferences or storage access')
        },
      },
    })
    expect(root.dataset.theme).toBe(light ? 'light' : 'dark')
    expect(root.style.colorScheme).toBe(root.dataset.theme)
    expect(change).toBeDefined()
    media.matches = !light
    change!()
    expect(root.dataset.theme).toBe(light ? 'dark' : 'light')
    expect(root.style.colorScheme).toBe(root.dataset.theme)
  })
})
