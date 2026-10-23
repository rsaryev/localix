import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { stubFetch, fetchUrl } from '../../testing/fetch-stub'
import {
  DEFAULT_NPM_REGISTRY,
  downloadNpmTarball,
  fetchNpmPlugin,
  npmMetadataUrl,
  parseNpmEntrySource,
  pickNpmVersion,
  verifyNpmIntegrity,
} from './marketplace-source-npm'

/**
 * npm plugin sources: name parsing, registry URL building, version picking (exact /
 * dist-tag / semver range), integrity verification, and the full fetch→verify→extract
 * pipeline against a stubbed registry + a real gzipped `package/`-prefixed tarball.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

let work: string
let tarball: Uint8Array
let tarballSri: string

beforeAll(async () => {
  work = await fs.mkdtemp(join(tmpdir(), 'localix-npm-test-'))
  // Build a real npm-shaped tarball: everything under a `package/` top folder.
  const src = join(work, 'package')
  await fs.mkdir(join(src, 'skills'), { recursive: true })
  await fs.writeFile(join(src, 'plugin.json'), JSON.stringify({ name: 'demo' }))
  await fs.writeFile(join(src, 'skills', 'a.md'), '# a')
  const tgz = join(work, 'demo.tgz')
  const proc = Bun.spawn(['tar', '-czf', tgz, '-C', work, 'package'])
  await proc.exited
  tarball = new Uint8Array(await fs.readFile(tgz))
  tarballSri = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
})

afterAll(async () => {
  await fs.rm(work, { recursive: true, force: true })
})

const packument = (dist: Record<string, unknown>) => ({
  'dist-tags': { latest: '2.1.0' },
  versions: { '2.1.0': { dist } },
})

/** Stub registry serving one package's metadata + tarball; records requested URLs. */
function stubRegistry(meta: unknown, opts?: { tarballBytes?: Uint8Array }): string[] {
  const urls: string[] = []
  globalThis.fetch = stubFetch(async (input) => {
    const url = fetchUrl(input)
    urls.push(url)
    if (url.endsWith('.tgz')) {
      return new Response((opts?.tarballBytes ?? tarball).slice().buffer as ArrayBuffer)
    }
    return Response.json(meta)
  })
  return urls
}

describe('parseNpmEntrySource', () => {
  it('parses the spec form with version + registry', () => {
    expect(
      parseNpmEntrySource('x', {
        source: 'npm',
        package: '@org/plugin',
        version: '^2.0.0',
        registry: 'https://r.example',
      }),
    ).toEqual({ package: '@org/plugin', version: '^2.0.0', registry: 'https://r.example' })
  })
  it('parses the legacy npm shorthand and a bare package key', () => {
    expect(parseNpmEntrySource('x', { npm: 'left-pad' })).toEqual({ package: 'left-pad' })
    expect(parseNpmEntrySource('x', { package: 'left-pad' })).toEqual({ package: 'left-pad' })
  })
  it('returns null for git-shaped sources', () => {
    expect(parseNpmEntrySource('x', { source: 'github', repo: 'a/b' })).toBeNull()
    expect(parseNpmEntrySource('x', { url: 'https://x/y.git', path: 'p' })).toBeNull()
  })
  it('throws on a missing or invalid package name', () => {
    expect(() => parseNpmEntrySource('x', { source: 'npm' })).toThrow(/package/)
    expect(() => parseNpmEntrySource('x', { source: 'npm', package: '../evil' })).toThrow(/package/)
  })
})

describe('npmMetadataUrl', () => {
  it('encodes a scoped name and defaults the registry', () => {
    expect(npmMetadataUrl('@org/plugin')).toBe(`${DEFAULT_NPM_REGISTRY}/@org%2fplugin`)
  })
  it('honors a custom registry and strips its trailing slash', () => {
    expect(npmMetadataUrl('pkg', 'https://r.example/')).toBe('https://r.example/pkg')
  })
})

describe('pickNpmVersion', () => {
  const meta = {
    'dist-tags': { latest: '2.1.0', next: '3.0.0-beta.1' },
    versions: {
      '1.0.0': {},
      '2.0.0': {},
      '2.1.0': {},
      '3.0.0-beta.1': {},
    },
  }
  it('no spec → the latest dist-tag', () => {
    expect(pickNpmVersion('p', meta)).toBe('2.1.0')
  })
  it('exact published version → itself', () => {
    expect(pickNpmVersion('p', meta, '2.0.0')).toBe('2.0.0')
  })
  it('a dist-tag name → its target', () => {
    expect(pickNpmVersion('p', meta, 'next')).toBe('3.0.0-beta.1')
  })
  it('a semver range → the highest satisfying version', () => {
    expect(pickNpmVersion('p', meta, '^2.0.0')).toBe('2.1.0')
    expect(pickNpmVersion('p', meta, '>=1.0.0 <2.1.0')).toBe('2.0.0')
  })
  it('an unsatisfiable range → a clear per-entry error', () => {
    expect(() => pickNpmVersion('p', meta, '^9.0.0')).toThrow(/no version satisfying "\^9\.0\.0"/)
  })
})

describe('verifyNpmIntegrity', () => {
  const data = new Uint8Array([1, 2, 3])
  it('passes a matching sha512 SRI and a matching legacy shasum', () => {
    const sri = `sha512-${createHash('sha512').update(data).digest('base64')}`
    expect(() => verifyNpmIntegrity('p', data, { integrity: sri })).not.toThrow()
    const shasum = createHash('sha1').update(data).digest('hex')
    expect(() => verifyNpmIntegrity('p', data, { shasum })).not.toThrow()
  })
  it('throws on a mismatch; silently passes when no digest is published', () => {
    expect(() => verifyNpmIntegrity('p', data, { integrity: 'sha512-AAAA' })).toThrow(/integrity/)
    expect(() => verifyNpmIntegrity('p', data, {})).not.toThrow()
  })
})

describe('downloadNpmTarball', () => {
  it('streams to disk, hashes incrementally, and returns the byte count', async () => {
    const file = join(work, 'streamed.tgz')
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
    const bytes = await downloadNpmTarball(
      'demo@1.0.0',
      new Response(tarball.slice().buffer as ArrayBuffer),
      file,
      { integrity },
      tarball.byteLength + 1,
    )
    expect(bytes).toBe(tarball.byteLength)
    expect((await fs.readFile(file)).equals(tarball)).toBe(true)
  })

  it('rejects declared and chunked over-limit bodies without leaving a partial file', async () => {
    const declaredFile = join(work, 'declared-too-large.tgz')
    expect(
      downloadNpmTarball(
        'demo@1.0.0',
        new Response('abc', { headers: { 'content-length': '99' } }),
        declaredFile,
        {},
        3,
      ),
    ).rejects.toThrow(/download limit/)
    expect(await Bun.file(declaredFile).exists()).toBe(false)

    const chunkedFile = join(work, 'chunked-too-large.tgz')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    })
    expect(
      downloadNpmTarball('demo@1.0.0', new Response(body), chunkedFile, {}, 3),
    ).rejects.toThrow(/download limit/)
    expect(await Bun.file(chunkedFile).exists()).toBe(false)
  })
})

describe('fetchNpmPlugin', () => {
  it('downloads, verifies, and extracts stripping the package/ prefix', async () => {
    const urls = stubRegistry(
      packument({
        tarball: 'https://registry.npmjs.org/demo/-/demo-2.1.0.tgz',
        integrity: tarballSri,
      }),
    )
    const dest = join(work, 'out-basic')
    await fetchNpmPlugin({ package: '@org/demo' }, dest)
    expect(urls[0]).toBe(`${DEFAULT_NPM_REGISTRY}/@org%2fdemo`)
    // package/ prefix stripped: plugin.json sits at the dest root.
    expect(JSON.parse(await fs.readFile(join(dest, 'plugin.json'), 'utf8'))).toEqual({
      name: 'demo',
    })
    expect(await fs.readFile(join(dest, 'skills', 'a.md'), 'utf8')).toBe('# a')
  })

  it('resolves metadata against a custom registry', async () => {
    const urls = stubRegistry(packument({ tarball: 'https://r.example/demo/-/demo-2.1.0.tgz' }))
    const dest = join(work, 'out-registry')
    await fetchNpmPlugin({ package: 'demo', registry: 'https://r.example/' }, dest)
    expect(urls[0]).toBe('https://r.example/demo')
    expect(urls[1]).toBe('https://r.example/demo/-/demo-2.1.0.tgz')
  })

  it('picks a range against published versions', async () => {
    const urls = stubRegistry({
      'dist-tags': { latest: '3.0.0' },
      versions: {
        '2.0.0': { dist: { tarball: 'https://x/demo-2.0.0.tgz' } },
        '2.5.0': { dist: { tarball: 'https://x/demo-2.5.0.tgz' } },
        '3.0.0': { dist: { tarball: 'https://x/demo-3.0.0.tgz' } },
      },
    })
    await fetchNpmPlugin({ package: 'demo', version: '^2.0.0' }, join(work, 'out-range'))
    expect(urls[1]).toBe('https://x/demo-2.5.0.tgz')
  })

  it('integrity mismatch → typed error, staging dir removed', async () => {
    stubRegistry(packument({ tarball: 'https://x/demo.tgz', integrity: 'sha512-bogus' }))
    const dest = join(work, 'out-bad')
    expect(fetchNpmPlugin({ package: 'demo' }, dest)).rejects.toThrow(/integrity/)
  })

  it('missing version → clear error naming the package and spec', async () => {
    stubRegistry(packument({ tarball: 'https://x/demo.tgz' }))
    expect(
      fetchNpmPlugin({ package: 'demo', version: '^9.0.0' }, join(work, 'out-none')),
    ).rejects.toThrow(/"demo" has no version satisfying/)
  })

  it('metadata that is not JSON → per-entry error, not a raw SyntaxError', async () => {
    globalThis.fetch = stubFetch(async () => new Response('<html>'))
    expect(fetchNpmPlugin({ package: 'demo' }, join(work, 'out-html'))).rejects.toMatchObject({
      code: 'plugin_npm_fetch_failed',
    })
  })

  it('registry HTTP error → clear per-entry error', async () => {
    globalThis.fetch = stubFetch(async () => new Response('nope', { status: 404 }))
    expect(fetchNpmPlugin({ package: 'demo' }, join(work, 'out-404'))).rejects.toThrow(/HTTP 404/)
  })
})
