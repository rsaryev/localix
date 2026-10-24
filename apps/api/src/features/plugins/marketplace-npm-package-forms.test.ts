import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fetchUrl, stubFetch } from '../../testing/fetch-stub'
import { isApiError } from '../../lib/errors'
import { fetchNpmPlugin, parseNpmEntrySource } from './marketplace-source-npm'

/**
 * The other `package` forms of an npm plugin source (marketplace-reference.md, "npm plugin
 * source"): a name with a version appended, an `https` tarball link, and a private registry that
 * the user's `.npmrc` holds a token for.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

let work: string
let tarball: Uint8Array
beforeAll(async () => {
  work = await fs.mkdtemp(join(tmpdir(), 'localix-npm-forms-'))
  await fs.mkdir(join(work, 'package'), { recursive: true })
  await fs.writeFile(join(work, 'package', 'plugin.json'), '{"name":"demo"}')
  const tgz = join(work, 'demo.tgz')
  await Bun.spawn(['tar', '-czf', tgz, '-C', work, 'package']).exited
  tarball = new Uint8Array(await fs.readFile(tgz))
})
afterAll(async () => {
  await fs.rm(work, { recursive: true, force: true })
})

/** A registry that answers metadata and tarballs, recording each request's URL and auth. */
function registry() {
  const seen: { url: string; auth: string | null }[] = []
  globalThis.fetch = stubFetch(async (input, init) => {
    const url = fetchUrl(input)
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') })
    if (url.endsWith('.tgz')) return new Response(tarball.slice().buffer as ArrayBuffer)
    return Response.json({
      'dist-tags': { latest: '3.0.0' },
      versions: {
        '2.0.0': { dist: { tarball: 'https://npm.example.com/demo/-/demo-2.0.0.tgz' } },
        '3.0.0': { dist: { tarball: 'https://npm.example.com/demo/-/demo-3.0.0.tgz' } },
      },
    })
  })
  return seen
}

describe('npm package forms', () => {
  it('a version appended to the name is the version', () => {
    expect(parseNpmEntrySource('x', { source: 'npm', package: '@org/formatter@2.0.0' })).toEqual({
      package: '@org/formatter',
      version: '2.0.0',
    })
    expect(parseNpmEntrySource('x', { source: 'npm', package: 'formatter@^2' })).toEqual({
      package: 'formatter',
      version: '^2',
    })
  })

  it('an https tarball link is downloaded as it is', async () => {
    const seen = registry()
    const src = parseNpmEntrySource('x', {
      source: 'npm',
      package: 'https://npm.example.com/demo/-/demo-2.0.0.tgz',
    })!
    const dest = join(work, 'out-tarball')
    await fetchNpmPlugin(src, dest, { defaultRegistry: 'https://registry.npmjs.org', home: work })
    expect(seen.map((r) => r.url)).toEqual(['https://npm.example.com/demo/-/demo-2.0.0.tgz'])
    expect(await fs.readFile(join(dest, 'plugin.json'), 'utf8')).toBe('{"name":"demo"}')
  })

  it('refuses a tarball link on a git host', () => {
    for (const link of [
      'https://github.com/o/r/releases/download/v1/x.tgz',
      'https://gitlab.com/o/r/-/archive/x.tgz',
    ]) {
      let error: unknown
      try {
        parseNpmEntrySource('x', { source: 'npm', package: link })
      } catch (caught) {
        error = caught
      }
      expect(isApiError(error)).toBe(true)
      expect((error as Error).message).toContain(link)
    }
    expect(
      parseNpmEntrySource('x', {
        source: 'npm',
        package: 'https://gitlab.com/api/v4/projects/1/packages/npm/x/-/x-1.0.0.tgz',
      })?.tarball,
    ).toContain('gitlab.com/api/v4/')
  })

  it('sends the .npmrc token to that registry, and only to it', async () => {
    await fs.writeFile(join(work, '.npmrc'), '//npm.example.com/:_authToken=s3cret\n')
    const seen = registry()
    await fetchNpmPlugin(
      { package: 'demo', registry: 'https://npm.example.com' },
      join(work, 'out-auth'),
      { defaultRegistry: 'https://registry.npmjs.org', home: work, env: {} },
    )
    expect(seen.every((r) => r.auth === 'Bearer s3cret')).toBe(true)
    await fs.rm(join(work, '.npmrc'))
  })
})
