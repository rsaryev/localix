import { describe, expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'

import { listingSignals, staticScore } from './ranking'

const NOW = Date.parse('2026-10-25T00:00:00Z')
const day = 24 * 60 * 60 * 1000
const complete = {
  summary: 'Lint TypeScript on save',
  category: 'Development',
  tags: ['lint'],
}

describe('a listing’s static score', () => {
  test('is its source’s trust weight times what the source and the listing say for it', () => {
    const plain = makeListing({ id: 'a', ...complete })
    expect(staticScore(plain, { now: NOW })).toBeCloseTo(0.35)
    const official = makeListing({
      id: 'b',
      ...complete,
      source: { id: 'o', label: 'O', trust: 'official' },
    })
    expect(staticScore(official, { now: NOW })).toBeCloseTo(0.7)
    const picked = makeListing({
      id: 'c',
      ...complete,
      featured: true,
      recommended: true,
      source: { id: 'l', label: 'L', trust: 'localix' },
    })
    expect(staticScore(picked, { now: NOW })).toBeCloseTo(1.8)
    const weighted = makeListing({
      id: 'd',
      ...complete,
      source: { id: 'w', label: 'W', trust: 'community', weight: 0.5 },
    })
    expect(staticScore(weighted, { now: NOW })).toBeCloseTo(0.5)
  })

  test('a fresh version counts for up to a fifth more, falling to nothing over a year', () => {
    const at = (age: number) =>
      staticScore(
        makeListing({
          id: 'f',
          ...complete,
          source: { id: 'l', label: 'L', trust: 'localix' },
          updatedAt: new Date(NOW - age).toISOString(),
        }),
        { now: NOW },
      )
    expect(at(0)).toBeCloseTo(1.2)
    expect(at(182.5 * day)).toBeCloseTo(1.1)
    expect(at(400 * day)).toBeCloseTo(1)
  })

  test('an empty entry sinks, but is never hidden', () => {
    const named = makeListing({ id: 'n', summary: '', tags: [], category: 'Other' })
    expect(staticScore(named, { now: NOW })).toBeCloseTo(0.35 * 0.6)
  })
})

describe('what a listing is about, for the open project to match', () => {
  test('its name, tags, category and components, as whole lowercase words', () => {
    const lsp = makeListing({
      id: 'ts-lsp',
      name: 'typescript-lsp',
      tags: ['TypeScript', 'Language server'],
      components: [{ kind: 'lsp-server', name: 'vtsls' }],
    })
    expect(listingSignals(lsp)).toBe(' typescript lsp language server vtsls ')
  })
})
