import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'
import { parseKnownMarketplaces } from '@rsaryev/llx-plugin/marketplace'

import { asRecorded, catalogAt, readKnownMarketplaces, writeKnownMarketplaces } from './records'
import { parseDeclaredSource } from './sources'

/**
 * The registry of added marketplaces, kept as Claude Code keeps it (`known_marketplaces.json`,
 * written and read by the kit), with the commit a git listing was fetched at beside it.
 */

const dir = tempDirPerTest('kit-market-records-')
const CATALOG = '.claude-plugin/marketplace.json'
const AT = '2026-01-01T00:00:00.000Z'
const github = { kind: 'github', repo: 'acme/plugins', path: CATALOG } as const

describe('the marketplace registry file', () => {
  it('is known_marketplaces.json as the kit reads it, with the commit kept aside', async () => {
    const record = { source: github, installLocation: join(dir(), 'acme'), lastUpdated: AT }
    await writeKnownMarketplaces(dir(), { acme: { ...record, gitCommitSha: 'abc' } })

    const text = readFileSync(join(dir(), 'known_marketplaces.json'), 'utf8')
    expect(parseKnownMarketplaces(text).marketplaces).toEqual({ acme: record })
    expect(text).not.toContain('abc')
    expect(await readKnownMarketplaces(dir())).toEqual({ acme: { ...record, gitCommitSha: 'abc' } })
  })

  it('reads a registry an earlier Localix wrote to known.json, and drops it on the next write', async () => {
    const folder = join(dir(), 'mine')
    writeTree(dir(), {
      'known.json': JSON.stringify({
        mine: { source: { source: 'local', path: folder }, installLocation: folder },
        acme: {
          source: { source: 'github', repo: 'acme/plugins' },
          installLocation: join(dir(), 'acme'),
          lastUpdated: AT,
          gitCommitSha: 'abc',
          autoUpdate: false,
        },
        gone: { source: { source: 'npm', package: 'm' }, installLocation: join(dir(), 'gone') },
      }),
    })

    const known = await readKnownMarketplaces(dir())
    expect(known.mine?.source).toEqual({ kind: 'directory', path: folder })
    expect(known.mine?.installLocation).toBe(folder)
    expect(typeof known.mine?.lastUpdated).toBe('string')
    expect(known.acme).toEqual({
      source: github,
      installLocation: join(dir(), 'acme'),
      lastUpdated: AT,
      gitCommitSha: 'abc',
      autoUpdate: false,
    })
    // Recorded as Claude Code records it, though refreshing it is refused.
    expect(known.gone?.source).toEqual({ kind: 'npm', package: 'm' })

    await writeKnownMarketplaces(dir(), known)
    expect(existsSync(join(dir(), 'known.json'))).toBe(false)
    expect(await readKnownMarketplaces(dir())).toEqual(known)
  })

  it('reads an unreadable registry as empty, leaving the file as it is', async () => {
    const file = join(dir(), 'known_marketplaces.json')
    writeFileSync(file, '{broken')
    expect(await readKnownMarketplaces(dir())).toEqual({})
    expect(readFileSync(file, 'utf8')).toBe('{broken')
  })
})

describe('asRecorded: a source as the registry gives it back', () => {
  it('compares a declared inline catalog with its record', async () => {
    const declared = parseDeclaredSource(
      {
        source: 'settings',
        name: 'team',
        plugins: [{ name: 'p', source: { source: 'github', repo: 'o/p' } }],
      },
      'team',
    )
    if ('error' in declared) throw new Error(declared.error)
    const record = { source: asRecorded(declared), installLocation: dir(), lastUpdated: AT }
    await writeKnownMarketplaces(dir(), { team: record })
    expect((await readKnownMarketplaces(dir())).team?.source).toEqual(asRecorded(declared))
    expect(asRecorded(github)).toEqual(github)
  })
})

describe('catalogAt: where a registered marketplace keeps its catalog', () => {
  it('reads a catalog file where it was added, its marketplace two folders up', () => {
    const file = '/home/me/m/.claude-plugin/marketplace.json'
    expect(catalogAt({ source: { kind: 'file', path: file }, installLocation: file })).toEqual({
      file,
      root: '/home/me/m',
    })
  })

  it('reads every other one at .claude-plugin/marketplace.json of its folder', () => {
    expect(catalogAt({ source: github, installLocation: '/r/acme' })).toEqual({
      file: join('/r/acme', CATALOG),
      root: '/r/acme',
    })
  })
})
