import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { fetchUrl, stubFetch } from '../../testing/fetch-stub'
import {
  DEFAULT_NPM_REGISTRY,
  npmUrlProblem,
  userDefaultNpmRegistry,
} from './marketplace-npm-registry'
import { fetchNpmPlugin } from './marketplace-source-npm'

/**
 * npm sources over plain http: refused before the registry is contacted, unless the URL is on the
 * user's own default registry (Claude Code's rule for `registry` and tarball links alike).
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const dir = tempDirPerTest('mkt-npm-http')

function record(handler: (url: string) => Response): string[] {
  const urls: string[] = []
  globalThis.fetch = stubFetch(async (input) => {
    const url = fetchUrl(input)
    urls.push(url)
    return handler(url)
  })
  return urls
}

const packument = (tarball: string) =>
  Response.json({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { dist: { tarball } } } })

describe('userDefaultNpmRegistry', () => {
  it('reads npm_config_registry, then ~/.npmrc, then the public registry', async () => {
    const home = dir()
    expect(await userDefaultNpmRegistry({}, home)).toBe(DEFAULT_NPM_REGISTRY)
    writeTree(home, {
      '.npmrc':
        '@acme:registry=https://scoped.example\n; comment\nregistry = http://npm.lan:4873/\n',
    })
    expect(await userDefaultNpmRegistry({}, home)).toBe('http://npm.lan:4873/')
    expect(await userDefaultNpmRegistry({ npm_config_registry: 'https://env.example' }, home)).toBe(
      'https://env.example',
    )
  })
})

describe('npmUrlProblem', () => {
  it('allows https, and http only on the default registry origin', () => {
    const lan = 'http://npm.lan:4873/'
    expect(npmUrlProblem(new URL('https://r.example/p'), DEFAULT_NPM_REGISTRY)).toBeNull()
    expect(npmUrlProblem(new URL('http://npm.lan:4873/p/-/p-1.tgz'), lan)).toBeNull()
    expect(npmUrlProblem(new URL('http://npm.lan:9999/p'), lan)).toContain('plain http')
    expect(npmUrlProblem(new URL('http://r.example/p'), DEFAULT_NPM_REGISTRY)).toContain(
      'plain http',
    )
    expect(npmUrlProblem(new URL('file:///etc/passwd'), DEFAULT_NPM_REGISTRY)).toContain(
      'not an http(s) URL',
    )
  })
})

describe('fetchNpmPlugin over plain http', () => {
  const opts = { defaultRegistry: DEFAULT_NPM_REGISTRY }

  it('refuses an http registry before contacting it', async () => {
    const urls = record(() => new Response('unreachable'))
    await expect(
      fetchNpmPlugin({ package: 'p', registry: 'http://r.example' }, join(dir(), 'out'), opts),
    ).rejects.toThrow('uses plain http and is not your default npm registry')
    expect(urls).toEqual([])
  })

  it('refuses an http tarball link, and an https tarball that redirects to http', async () => {
    let urls = record(() => packument('http://cdn.example/p-1.0.0.tgz'))
    await expect(fetchNpmPlugin({ package: 'p' }, join(dir(), 'out'), opts)).rejects.toThrow(
      'uses plain http',
    )
    expect(urls).toEqual([`${DEFAULT_NPM_REGISTRY}/p`])

    urls = record((url) =>
      url.endsWith('.tgz')
        ? new Response(null, { status: 302, headers: { location: 'http://cdn.example/p.tgz' } })
        : packument('https://cdn.example/p-1.0.0.tgz'),
    )
    await expect(fetchNpmPlugin({ package: 'p' }, join(dir(), 'out'), opts)).rejects.toThrow(
      'uses plain http',
    )
    expect(urls).toEqual([`${DEFAULT_NPM_REGISTRY}/p`, 'https://cdn.example/p-1.0.0.tgz'])
  })

  it('lets plain http through when it is the user default registry', async () => {
    const lan = 'http://npm.lan:4873'
    const urls = record((url) =>
      url.endsWith('.tgz') ? new Response('not a tarball') : packument(`${lan}/p/-/p-1.0.0.tgz`),
    )
    // Reaches the tarball (and fails only at extraction): neither URL was refused.
    await expect(
      fetchNpmPlugin({ package: 'p', registry: lan }, join(dir(), 'out'), {
        defaultRegistry: `${lan}/`,
      }),
    ).rejects.toThrow('Extracting npm tarball')
    expect(urls).toEqual([`${lan}/p`, `${lan}/p/-/p-1.0.0.tgz`])
  })
})
