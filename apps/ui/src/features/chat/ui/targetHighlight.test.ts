import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

const read = (url: URL) => readFileSync(url, 'utf8')

describe('search and navigation target highlight', () => {
  test('uses one neutral foreground-derived language instead of info blue', () => {
    const css = readKitStylesheet()
    const contract = css.slice(css.indexOf('.lx-search-match'), css.indexOf('/* Hover-only'))
    const message = read(new URL('./MessageCard.tsx', import.meta.url))
    const history = read(new URL('./HistorySearchResults.tsx', import.meta.url))
    const targetRegistry = read(new URL('../../../shared/lib/uiTargetRegistry.ts', import.meta.url))

    expect(contract).toContain('var(--foreground)')
    expect(contract).toContain('.lx-search-mark')
    expect(contract).toContain('.lx-target-reveal')
    expect(contract).not.toContain('status-info')
    expect(contract).not.toContain('var(--ring)')
    expect(message).toContain("isSearchMatch ? 'lx-search-match rounded-2xl'")
    expect(message).not.toContain('ring-status-info')
    expect(history).toContain('lx-search-mark')
    expect(targetRegistry).toContain("flashClassName: 'lx-target-reveal'")
  })
})
