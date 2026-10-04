import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `index.html` carries a copy of the theme decision, inline and blocking, because the real one
 * (`getSystemTheme` in useTheme.ts) cannot run before the bundle loads. Two implementations of one
 * rule drift, and this one drifted in the way that produces a visible defect: the guard asked
 * `prefers-color-scheme: dark` and fell back to LIGHT, while the app asks
 * `prefers-color-scheme: light` and falls back to DARK.
 *
 * Identical answers while the media query HAS an answer — and opposite answers while it does not,
 * which is a real state: a webview applies its native appearance asynchronously after the window is
 * built, so during HTML parse both queries can report false. The guard then painted #f8f8f8 and
 * React painted #070707 a moment later: the white-then-black startup flash, worst in dev where first
 * paint is seconds away.
 *
 * These assertions read the actual files, so the two cannot drift apart again silently.
 */
const uiRoot = join(import.meta.dir, '../../..')
const indexHtml = readFileSync(join(uiRoot, 'index.html'), 'utf8')
const useTheme = readFileSync(join(uiRoot, 'src/shared/theme/useTheme.ts'), 'utf8')

/** The media query + which branch each side treats as its fallback. */
function decision(source: string): { query: string; fallback: 'dark' | 'light' } | null {
  const match =
    /matchMedia\('\(prefers-color-scheme: (light|dark)\)'\)\s*\.?\s*matches\s*(?:\r?\n\s*)?\?\s*'?(light|dark)'?/u.exec(
      source,
    )
  if (!match) return null
  // The ternary's TRUE branch is the queried scheme's answer; the fallback is the other one.
  return { query: match[1]!, fallback: match[2] === 'dark' ? 'light' : 'dark' }
}

describe('startup anti-flash guard', () => {
  test('asks the OS the same question the app does, with the same fallback', () => {
    const guard = decision(indexHtml)
    const app = decision(useTheme)
    expect(guard).not.toBeNull()
    expect(app).not.toBeNull()
    expect(guard).toEqual(app)
  })

  test('an unresolved media query falls back to DARK, never to a white paint', () => {
    // The app is dark-first; a fallback of `light` is what made an unresolved query paint #f8f8f8.
    expect(decision(indexHtml)?.fallback).toBe('dark')
    expect(decision(useTheme)?.fallback).toBe('dark')
  })

  test('the guard still honours an explicit stored choice over any OS query', () => {
    // Order matters: an explicit 'light'/'dark' must be taken before `system` is resolved, or a
    // forced theme would follow the OS instead of the user.
    const explicitAt = indexHtml.indexOf("stored === 'light' || stored === 'dark'")
    const systemAt = indexHtml.indexOf("stored === 'system'")
    expect(explicitAt).toBeGreaterThan(-1)
    expect(systemAt).toBeGreaterThan(explicitAt)
  })

  test('the guard paints the same two backgrounds the app uses', () => {
    // The inline style is what covers the webview before any CSS exists; a value that drifts from
    // THEME_BACKGROUNDS would flash a near-miss colour instead of no colour change at all.
    for (const hex of ['#070707', '#f8f8f8']) {
      expect(indexHtml).toContain(hex)
      expect(useTheme).toContain(hex)
    }
  })
})
