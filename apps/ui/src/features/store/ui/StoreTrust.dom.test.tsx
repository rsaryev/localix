import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ADA, listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

/** What a provider says of a thing the person made: no source to rate, so no `trust`. */
const mine = listing({
  id: 'files',
  displayName: 'Files',
  ref: { kind: 'mcp-server', id: 'files' },
  authored: 'user',
  publisher: { name: 'You', verified: false },
  source: { id: 'mcp:yours', label: 'Your servers' },
})
const fromCommunity = listing({
  id: 'radio',
  displayName: 'Radio',
  publisher: { name: 'Ada', verified: false },
  source: { id: ADA, label: 'Ada', trust: 'community' },
})
const fromLocalix = listing({ id: 'puzzle', displayName: 'Puzzle' })
const LISTINGS = [mine, fromCommunity, fromLocalix]

const DISCOVER = {
  hero: null,
  rows: [
    {
      id: 'start',
      title: 'Start here',
      style: 'row' as const,
      items: LISTINGS.map((l) => l.ref),
    },
  ],
  categories: [],
}

describe('trust is said only for what a source lists', () => {
  test('a row of the person’s own item carries no trust label, a community one does', async () => {
    const own = await renderStore({ listings: LISTINGS, target: { shelf: 'yours' } })
    try {
      expect(own.card('files')!.textContent).not.toContain('Community')
      expect(own.card('files')!.querySelector('[aria-label^="Verified"]')).toBeNull()
    } finally {
      await own.done()
    }
    const apps = await renderStore({ listings: LISTINGS, target: { shelf: 'package:mini-app' } })
    try {
      expect(apps.card('radio')!.textContent).toContain('Community')
      expect(apps.card('puzzle')!.querySelector('[aria-label="Verified · Localix"]')).not.toBeNull()
    } finally {
      await apps.done()
    }
  })

  test('a tile says who and what in one line, with no trust label for the person’s own', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      const tile = (id: string) =>
        view.host.querySelector<HTMLElement>(
          `[data-store-scroller] section [data-listing="${id}"]`,
        )!
      const meta = (id: string) => tile(id).querySelector('[data-slot="tile-meta"]')?.textContent
      expect(meta('files')).toBe('You · MCP server')
      expect(meta('radio')).toBe('Ada · Mini app')
      expect(meta('puzzle')).toBe('Localix · Mini app')
      expect(tile('files').textContent).not.toContain('Community')
      expect(tile('puzzle').querySelector('[aria-label="Verified · Localix"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })
})
