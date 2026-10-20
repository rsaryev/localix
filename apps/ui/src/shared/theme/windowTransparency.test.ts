import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_WINDOW_TRANSPARENCY,
  WINDOW_TRANSPARENCY_LEVELS,
  WINDOW_TRANSPARENCY_STORAGE_KEY,
  parseWindowTransparency,
} from './windowTransparency'

describe('window transparency preference', () => {
  test('keeps a known level and falls back to standard for anything else', () => {
    for (const level of WINDOW_TRANSPARENCY_LEVELS)
      expect(parseWindowTransparency(level)).toBe(level)
    expect(parseWindowTransparency(null)).toBe(DEFAULT_WINDOW_TRANSPARENCY)
    expect(parseWindowTransparency('glass')).toBe(DEFAULT_WINDOW_TRANSPARENCY)
    expect(DEFAULT_WINDOW_TRANSPARENCY).toBe('standard')
  })

  // The boot script cannot import this module, so it restates the key and the levels; this is the
  // test that notices when the two drift apart.
  test('the index.html boot script stamps the same key and every non-default level', () => {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
    expect(html).toContain(`localStorage.getItem('${WINDOW_TRANSPARENCY_STORAGE_KEY}')`)
    for (const level of WINDOW_TRANSPARENCY_LEVELS) {
      if (level === DEFAULT_WINDOW_TRANSPARENCY) continue
      expect(html).toContain(`transparency === '${level}'`)
    }
  })

  test('every non-default level has a coat rule in the kit material', () => {
    const css = readFileSync(
      new URL('../../../../../packages/kit/styles/window-material.css', import.meta.url),
      'utf8',
    )
    for (const level of WINDOW_TRANSPARENCY_LEVELS) {
      if (level === DEFAULT_WINDOW_TRANSPARENCY) continue
      expect(css).toContain(`:root[data-window-transparency='${level}'] {`)
    }
  })
})
