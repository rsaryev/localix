import { describe, expect, test } from 'bun:test'

import { lockMatches } from '../src/features/lsp/lsp-npm-lock'
import { relockRegistry, updateRegistry, type LspRegistry } from './lsp-update'

const NOW = new Date('2026-10-26T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

/** The registries, answered from memory; any other host fails as a real one would in tests. */
function registries(answers: Record<string, unknown>) {
  const asked: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    asked.push(url)
    if (!(url in answers)) return new Response('not found', { status: 404 })
    const body = answers[url]
    return typeof body === 'string' ? new Response(body) : Response.json(body)
  }) as typeof fetch
  return { asked, fetchImpl }
}

const registry = (servers: LspRegistry['servers']): LspRegistry => ({ $comment: 'x', servers })

describe('lsp:update', () => {
  test('npm: the newest stable release a week old, within a hold, never older', async () => {
    const { fetchImpl } = registries({
      'https://registry.npmjs.org/typescript-language-server': {
        versions: { '6.0.2': {}, '6.1.0': {}, '7.0.0-beta.1': {}, '7.0.0': {} },
        time: {
          created: daysAgo(900),
          '6.0.2': daysAgo(60),
          '6.1.0': daysAgo(10),
          '7.0.0-beta.1': daysAgo(9),
          // Too fresh: a hijacked release is usually caught within days.
          '7.0.0': daysAgo(2),
        },
      },
      'https://registry.npmjs.org/typescript': {
        versions: { '5.9.3': {}, '5.9.4': {}, '6.0.1': {} },
        time: { '5.9.3': daysAgo(90), '5.9.4': daysAgo(30), '6.0.1': daysAgo(20) },
      },
      'https://registry.npmjs.org/@vtsls%2Flanguage-server': {
        versions: { '0.2.9': {}, '0.3.0': {} },
        time: { '0.2.9': daysAgo(5), '0.3.0': daysAgo(80) },
      },
    })
    const { registry: next, changes } = await updateRegistry(
      registry({
        'typescript-language-server': {
          source: 'pkg:npm/typescript-language-server@6.0.2',
          with: ['pkg:npm/typescript@5.9.3'],
          hold: { typescript: '<6' },
          bin: ['typescript-language-server'],
        },
        typescript: { source: 'pkg:npm/%40vtsls/language-server@0.3.0', bin: ['vtsls'] },
      }),
      { fetchImpl, now: NOW },
    )
    expect(next.servers['typescript-language-server']).toMatchObject({
      source: 'pkg:npm/typescript-language-server@6.1.0',
      with: ['pkg:npm/typescript@5.9.4'],
    })
    expect(next.servers.typescript!.source).toBe('pkg:npm/%40vtsls/language-server@0.3.0')
    expect(changes).toEqual([
      'typescript-language-server: typescript-language-server 6.0.2 → 6.1.0',
      'typescript-language-server: typescript 5.9.3 → 5.9.4',
    ])
  })

  test('golang: the newest stable module version a week old, from the Go proxy', async () => {
    const proxy = 'https://proxy.golang.org/golang.org/x/tools/gopls/@v'
    const { fetchImpl, asked } = registries({
      [`${proxy}/list`]: 'v0.24.0\nv0.25.0\nv0.26.0-pre.1\nv0.26.0\n',
      [`${proxy}/v0.26.0.info`]: { Version: 'v0.26.0', Time: daysAgo(3) },
      [`${proxy}/v0.25.0.info`]: { Version: 'v0.25.0', Time: daysAgo(15) },
    })
    const { registry: next } = await updateRegistry(
      registry({
        gopls: { source: 'pkg:golang/golang.org/x/tools/gopls@v0.24.0', bin: ['gopls'] },
      }),
      { fetchImpl, now: NOW },
    )
    expect(next.servers.gopls!.source).toBe('pkg:golang/golang.org/x/tools/gopls@v0.25.0')
    expect(asked).not.toContain(`${proxy}/v0.26.0-pre.1.info`)
  })

  test('github: the newest release a week old, with each asset’s size and sha256', async () => {
    const asset = (name: string, size: number, digest?: string) => ({
      name,
      size,
      ...(digest ? { digest: `sha256:${digest}` } : {}),
      browser_download_url: `https://downloads.example/${name}`,
    })
    const undigested = new TextEncoder().encode('linux build')
    const { fetchImpl } = registries({
      'https://api.github.com/repos/rust-lang/rust-analyzer/releases?per_page=30': [
        { tag_name: 'nightly', prerelease: true, draft: false, published_at: daysAgo(0) },
        { tag_name: '2026-10-19', prerelease: false, draft: false, published_at: daysAgo(4) },
        {
          tag_name: '2026-10-12',
          prerelease: false,
          draft: false,
          published_at: daysAgo(14),
          assets: [
            asset('rust-analyzer-aarch64-apple-darwin.gz', 100, 'a'.repeat(64)),
            asset('rust-analyzer-x86_64-unknown-linux-gnu.gz', undigested.byteLength),
          ],
        },
      ],
      'https://downloads.example/rust-analyzer-x86_64-unknown-linux-gnu.gz':
        new TextDecoder().decode(undigested),
    })
    const { registry: next } = await updateRegistry(
      registry({
        'rust-analyzer': {
          source: 'pkg:github/rust-lang/rust-analyzer@2026-10-05',
          bin: ['rust-analyzer'],
          assets: {
            'darwin-arm64': {
              file: 'rust-analyzer-aarch64-apple-darwin.gz',
              bytes: 1,
              sha256: '0',
            },
            'linux-x64': {
              file: 'rust-analyzer-x86_64-unknown-linux-gnu.gz',
              bytes: 1,
              sha256: '0',
            },
          },
        },
      }),
      { fetchImpl, now: NOW },
    )
    expect(next.servers['rust-analyzer']).toMatchObject({
      source: 'pkg:github/rust-lang/rust-analyzer@2026-10-12',
      assets: {
        'darwin-arm64': { bytes: 100, sha256: 'a'.repeat(64) },
        'linux-x64': {
          bytes: undigested.byteLength,
          sha256: new Bun.CryptoHasher('sha256').update(undigested).digest('hex'),
        },
      },
    })
  })

  test('a release that dropped a platform’s asset stops the update rather than losing it', async () => {
    const { fetchImpl } = registries({
      'https://api.github.com/repos/rust-lang/rust-analyzer/releases?per_page=30': [
        {
          tag_name: '2026-10-12',
          prerelease: false,
          draft: false,
          published_at: daysAgo(14),
          assets: [],
        },
      ],
    })
    const update = updateRegistry(
      registry({
        'rust-analyzer': {
          source: 'pkg:github/rust-lang/rust-analyzer@2026-10-05',
          bin: ['rust-analyzer'],
          assets: { 'win32-x64': { file: 'rust-analyzer.zip', bytes: 1, sha256: '0' } },
        },
      }),
      { fetchImpl, now: NOW },
    )
    await expect(update).rejects.toThrow('rust-analyzer.zip')
  })
})

describe('lsp:update lockfiles', () => {
  const servers = registry({
    yaml: { source: 'pkg:npm/yaml-language-server@2.0.0', bin: ['yaml-language-server'] },
    typescript: {
      source: 'pkg:npm/typescript-language-server@6.0.2',
      with: ['pkg:npm/typescript@5.9.3'],
      bin: ['typescript-language-server'],
    },
    gopls: { source: 'pkg:golang/golang.org/x/tools/gopls@v0.24.0', bin: ['gopls'] },
  })
  /** What `bun install --lockfile-only` writes: the root's name and dependencies, then packages. */
  const lockFor = (manifest: { name: string; dependencies: Record<string, string> }) =>
    `${JSON.stringify({ lockfileVersion: 2, workspaces: { '': manifest }, packages: {} })}\n`

  test('locks each npm server from the manifest the installer writes', async () => {
    const resolved: string[] = []
    const { locks, changed } = await relockRegistry(servers, {
      current: {},
      resolve: async (manifest) => (resolved.push(manifest.name), lockFor(manifest)),
    })
    expect(changed.sort()).toEqual(['typescript', 'yaml'])
    expect(resolved.sort()).toEqual(['localix-lsp-typescript', 'localix-lsp-yaml'])
    expect(Object.keys(locks).sort()).toEqual(['typescript', 'yaml'])
    expect(locks.typescript).toContain('"typescript":"5.9.3"')
  })

  test('keeps a current lockfile, redoes one whose pin moved, drops one of a removed server', async () => {
    const { locks: first } = await relockRegistry(servers, {
      current: {},
      resolve: async (m) => lockFor(m),
    })
    const moved = registry({
      ...servers.servers,
      yaml: { source: 'pkg:npm/yaml-language-server@2.1.0', bin: ['yaml-language-server'] },
    })
    const resolved: string[] = []
    const { locks, changed } = await relockRegistry(moved, {
      current: { ...first, removed: '{}' },
      resolve: async (manifest) => (resolved.push(manifest.name), lockFor(manifest)),
    })
    expect(changed).toEqual(['yaml'])
    expect(resolved).toEqual(['localix-lsp-yaml'])
    expect(Object.keys(locks).sort()).toEqual(['typescript', 'yaml'])
    expect(locks.typescript).toBe(first.typescript!)
    expect(
      lockMatches(locks.yaml!, {
        name: 'localix-lsp-yaml',
        private: true,
        dependencies: { 'yaml-language-server': '2.1.0' },
      }),
    ).toBe(true)
  })
})
