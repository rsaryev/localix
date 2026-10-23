import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const landingDir = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(landingDir, rel), 'utf8')

describe('landing theme', () => {
  test('the first paint and browser chrome are always dark', () => {
    const html = read('index.html')
    expect(html).toContain('data-theme="dark" data-site="landing"')
    expect(html).toContain('<meta name="color-scheme" content="dark"')
    expect(html).toContain('<meta name="theme-color" content="#070707"')
    expect(html).toContain('color-scheme: dark')
    expect(html).not.toContain('prefers-color-scheme')
  })

  test.each([false, true])('startup preserves dark appearance with system light=%s', (light) => {
    const root = {
      dataset: { theme: 'dark' },
      style: { colorScheme: 'dark' },
      classList: { add() {} },
    }
    for (const match of read('index.html').matchAll(/<script>([\s\S]*?)<\/script>/gu)) {
      runInNewContext(match[1]!, {
        document: { documentElement: root },
        window: { IntersectionObserver: class {} },
        matchMedia(query: string) {
          if (query.includes('prefers-color-scheme'))
            throw new Error('Landing must not follow system appearance')
          return { matches: query === '(prefers-reduced-motion: reduce)' ? false : light }
        },
      })
    }
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })
})
