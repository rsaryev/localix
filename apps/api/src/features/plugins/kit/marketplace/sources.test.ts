import { describe, expect, it } from 'bun:test'

import {
  describeSource,
  marketplaceAddRefusal,
  marketplaceFetchPlan,
  parseDeclaredSource,
  parseMarketplaceAdd,
  sameMarketplaceSource,
} from './sources'

const where = { cwd: '/work/repo', home: '/home/me' }
const CATALOG = '.claude-plugin/marketplace.json'

describe('parseMarketplaceAdd: what is typed after /plugin marketplace add', () => {
  it('reads the forms Claude Code reads', () => {
    expect(parseMarketplaceAdd('acme/plugins#v2', where)).toEqual({
      kind: 'github',
      repo: 'acme/plugins',
      ref: 'v2',
      path: CATALOG,
    })
    // A github.com address is recorded as a git source, as Claude Code records it.
    expect(parseMarketplaceAdd('https://github.com/acme/plugins', where)).toEqual({
      kind: 'git',
      url: 'https://github.com/acme/plugins.git',
      path: CATALOG,
    })
    expect(parseMarketplaceAdd('https://example.com/marketplace.json', where)).toEqual({
      kind: 'url',
      url: 'https://example.com/marketplace.json',
    })
  })

  it('places a local path in the working folder, and ~ in the home folder', () => {
    expect(parseMarketplaceAdd('./market', where)).toEqual({
      kind: 'directory',
      path: '/work/repo/market',
    })
    expect(parseMarketplaceAdd('~/m/.claude-plugin/marketplace.json', where)).toEqual({
      kind: 'file',
      path: '/home/me/m/.claude-plugin/marketplace.json',
    })
  })

  it('refuses what Claude Code refuses, in its words', () => {
    const unrecognized =
      'Invalid marketplace source format. Try: owner/repo, https://..., or ./path'
    expect(parseMarketplaceAdd('npm:acme-marketplace', where)).toEqual({ error: unrecognized })
    expect(parseMarketplaceAdd('cool@acme', where)).toEqual({ error: unrecognized })
  })
})

describe('parseDeclaredSource: a source object of extraKnownMarketplaces', () => {
  it('reads a declared source, with the catalog path Claude Code defaults to', () => {
    expect(parseDeclaredSource({ source: 'github', repo: 'acme/plugins' }, 'acme')).toEqual({
      kind: 'github',
      repo: 'acme/plugins',
      path: CATALOG,
    })
  })

  it('refuses a source that would not load, and one only the policy lists take', () => {
    expect(parseDeclaredSource({ source: 'npm', package: '@acme/m' }, 'acme')).toEqual({
      error: 'NPM marketplace sources not yet implemented',
    })
    expect(
      parseDeclaredSource({ source: 'hostPattern', hostPattern: '.*' }, 'acme'),
    ).toHaveProperty('error')
  })

  it('refuses an inline catalog named other than its key', () => {
    const inline = { source: 'settings', name: 'other', plugins: [] }
    expect(parseDeclaredSource(inline, 'team')).toHaveProperty('error')
    expect(parseDeclaredSource({ ...inline, name: 'team' }, 'team')).toMatchObject({
      kind: 'settings',
      name: 'team',
    })
  })
})

describe('marketplaceAddRefusal: the name a fetched catalog registers under', () => {
  const github = { kind: 'github', repo: 'acme/plugins', path: CATALOG } as const

  it('keeps the official names for Anthropic repositories', () => {
    expect(marketplaceAddRefusal('claude-plugins-official', github, {})).toContain(
      "is reserved for official Anthropic marketplaces. Only repositories from 'github.com/anthropics/'",
    )
    const anthropic = { ...github, repo: 'anthropics/claude-plugins-official' }
    expect(marketplaceAddRefusal('claude-plugins-official', anthropic, {})).toBeUndefined()
  })

  it('never re-points a name registered from another source', () => {
    const registered = { acme: { source: { ...github, repo: 'acme/other' } } }
    expect(marketplaceAddRefusal('acme', github, registered)).toBe(
      'Marketplace "acme" is already added from a different source (github:acme/other). To use this source instead, remove that marketplace first with /plugin marketplace remove acme.',
    )
    expect(marketplaceAddRefusal('acme', github, { acme: { source: github } })).toBeUndefined()
  })

  it("refuses the name of another GitHub marketplace's download folder", () => {
    expect(marketplaceAddRefusal('acme-plugins', github, { acme: { source: github } })).toContain(
      'it is the download folder of the registered marketplace "acme"',
    )
  })
})

describe('marketplaceFetchPlan', () => {
  it('plans a clone with its catalog path and sparse folders', () => {
    expect(
      marketplaceFetchPlan({
        kind: 'github',
        repo: 'a/b',
        path: CATALOG,
        sparsePaths: ['plugins'],
      }),
    ).toMatchObject({
      kind: 'git',
      repo: { shorthand: 'a/b' },
      path: CATALOG,
      sparsePaths: ['plugins'],
    })
  })

  it('throws what refuses the source', () => {
    expect(() => marketplaceFetchPlan({ kind: 'npm', package: 'm' })).toThrow(
      'NPM marketplace sources not yet implemented',
    )
  })
})

describe('source identity', () => {
  it('is the same source only with the same value in every field', () => {
    const a = { kind: 'github', repo: 'a/b', path: CATALOG } as const
    expect(sameMarketplaceSource(a, { ...a })).toBe(true)
    expect(sameMarketplaceSource(a, { ...a, ref: 'v1' })).toBe(false)
    expect(describeSource(a)).toBe('github:a/b')
  })
})
