import { afterEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { fetchUrl, stubFetch } from '../../testing/fetch-stub'
import { addMarketplace, readKnownMarketplaces } from './marketplace-registry'
import { readMarketplace } from './marketplace-catalog'
import { parseMarketplaceInput } from './marketplace-source'

/**
 * Marketplace sources written as objects, as `extraKnownMarketplaces` holds them
 * (marketplace-reference.md, "Marketplace sources" and "Fields by type"): `github` and `git` with
 * `path` and `sparsePaths`, `url` with `headers`, `directory`, `file`, and an inline `settings`
 * catalog.
 */

const dir = tempDirPerTest('mkt-source-object-')
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const catalog = (name: string) =>
  JSON.stringify({ name, owner: { name: 'Acme' }, plugins: [{ name: 'p', source: './p' }] })

describe('object marketplace sources', () => {
  it('parses every type a settings file may hold', () => {
    expect(
      parseMarketplaceInput({ source: 'github', repo: 'o/r', ref: 'v1', path: 'x/m.json' }),
    ).toEqual({ source: 'github', repo: 'o/r', ref: 'v1', path: 'x/m.json' })
    expect(
      parseMarketplaceInput({ source: 'git', url: 'https://h/r.git', sparsePaths: ['a', 'b'] }),
    ).toEqual({ source: 'git', url: 'https://h/r.git', sparsePaths: ['a', 'b'] })
    expect(parseMarketplaceInput({ source: 'directory', path: '/m' })).toEqual({
      source: 'local',
      path: '/m',
    })
    expect(parseMarketplaceInput({ source: 'file', path: '/m/m.json' })).toEqual({
      source: 'file',
      path: '/m/m.json',
    })
    expect(
      parseMarketplaceInput({ source: 'url', url: 'https://h/m.json', headers: { a: 'b' } }),
    ).toEqual({ source: 'url', url: 'https://h/m.json', headers: { a: 'b' } })
    expect(parseMarketplaceInput({ source: 'skills-dir' })).toEqual({
      error: 'Unsupported marketplace source type "skills-dir"',
    })
  })

  it('reads the catalog at `path` and checks out only `sparsePaths`', async () => {
    writeTree(join(dir(), 'repo'), {
      'meta/catalog.json': catalog('acme'),
      'p/.claude-plugin/plugin.json': '{"name":"p"}',
    })
    const sparse: unknown[] = []
    const deps = {
      root: join(dir(), 'marketplaces'),
      cloneRepo: async (_url: string, dest: string, _ref?: string, only?: string | string[]) => {
        sparse.push(only)
        await fs.cp(join(dir(), 'repo'), dest, { recursive: true })
      },
    }
    const added = await addMarketplace(
      { source: 'github', repo: 'o/r', path: 'meta/catalog.json', sparsePaths: ['meta', 'p'] },
      deps,
    )
    expect(added).toEqual({ name: 'acme', count: 1 })
    expect(sparse).toEqual([['meta', 'p']])
  })

  it('sends a url source its headers', async () => {
    const auth: (string | null)[] = []
    globalThis.fetch = stubFetch(async (input, init) => {
      auth.push(new Headers(init?.headers).get('authorization'))
      return new Response(fetchUrl(input) ? catalog('hosted') : '')
    })
    await addMarketplace(
      { source: 'url', url: 'https://cat.example.com/m.json', headers: { Authorization: 'X' } },
      { root: join(dir(), 'marketplaces'), cloneRepo: async () => {} },
    )
    expect(auth).toEqual(['X'])
  })

  it('takes an inline settings catalog as it is', async () => {
    const root = join(dir(), 'marketplaces')
    const added = await addMarketplace(
      {
        source: 'settings',
        name: 'team',
        owner: { name: 'Team' },
        plugins: [{ name: 'lint', source: { source: 'github', repo: 'o/lint' } }],
      },
      { root, cloneRepo: async () => {} },
    )
    expect(added).toEqual({ name: 'team', count: 1 })
    const known = await readKnownMarketplaces(root)
    expect((await readMarketplace(known.team!.installLocation)).plugins[0]?.name).toBe('lint')
  })
})
