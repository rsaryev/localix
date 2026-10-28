import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { tempDirPerTest } from '@localixai/testing'

import { createLspInstaller, type InstallCommand } from './lsp-installer'
import { lspPackage, type LspPackage } from './lsp-registry'

const dir = tempDirPerTest('localix-lsp-install')
/** The shipped lockfiles, as `lsp:update` would write them: one for `yaml`. */
const lockDir = () => ({ yaml: '{ "lockfileVersion": 2 }\n' })

const NPM: LspPackage = lspPackage('yaml', {
  source: 'pkg:npm/yaml-language-server@2.0.0',
  with: ['pkg:npm/%40types/node@24.0.0'],
  bin: ['yaml-language-server'],
})

const binary = new TextEncoder().encode('#!/bin/sh\necho rust-analyzer\n')
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
const archive = gzipSync(binary)

function releasePackage(sha = sha256(archive)): LspPackage {
  return lspPackage('rust-analyzer', {
    source: 'pkg:github/rust-lang/rust-analyzer@2026-10-12',
    bin: ['rust-analyzer'],
    assets: {
      'darwin-arm64': {
        file: 'rust-analyzer-aarch64-apple-darwin.gz',
        bytes: archive.byteLength,
        sha256: sha,
      },
    },
  })
}

const GO: LspPackage = lspPackage('gopls', {
  source: 'pkg:golang/golang.org/x/tools/gopls@v0.24.0',
  bin: ['gopls'],
})

/** A process stub: records each command and answers with the given exit and output. */
function commands(answer: (call: InstallCommand) => { code: number; output: string }) {
  const calls: InstallCommand[] = []
  return {
    calls,
    run: async (call: InstallCommand) => {
      calls.push(call)
      return answer(call)
    },
  }
}

describe('npm language servers', () => {
  test('installs the exact versions once with Bun, into a versioned folder', async () => {
    const proc = commands((call) => {
      // Bun reads the manifest the installer wrote, then fills node_modules.
      expect(JSON.parse(readFileSync(path.join(call.cwd, 'package.json'), 'utf8'))).toEqual({
        name: 'localix-lsp-yaml',
        private: true,
        dependencies: { 'yaml-language-server': '2.0.0', '@types/node': '24.0.0' },
      })
      expect(readFileSync(path.join(call.cwd, 'bun.lock'), 'utf8')).toBe(
        '{ "lockfileVersion": 2 }\n',
      )
      writeFileSync(path.join(call.cwd, 'node_modules.txt'), 'installed')
      return { code: 0, output: '' }
    })
    const installer = createLspInstaller({
      root: dir(),
      packages: { yaml: NPM },
      locks: lockDir(),
      run: proc.run,
      runtime: '/bin/bun',
    })

    expect(installer.installedDir('yaml')).toBeUndefined()
    const outcome = await installer.install('yaml')
    expect(outcome.ok).toBe(true)
    const installed = installer.installedDir('yaml')!
    expect(outcome).toEqual({ ok: true, dir: installed })
    expect(installed.startsWith(path.join(dir(), 'yaml'))).toBe(true)
    expect(existsSync(path.join(installed, 'node_modules.txt'))).toBe(true)
    // The shipped lockfile pins the whole tree and must not move; no install scripts run, and
    // nothing published in the last week is taken.
    expect(proc.calls.map(({ command, args }) => [command, args])).toEqual([
      [
        '/bin/bun',
        [
          'install',
          '--ignore-scripts',
          '--production',
          '--frozen-lockfile',
          '--minimum-release-age=604800',
        ],
      ],
    ])

    expect(await installer.install('yaml')).toEqual({ ok: true, dir: installed })
    expect(proc.calls).toHaveLength(1)
  })

  test('a server without a shipped lockfile fails loudly rather than floating its dependencies', async () => {
    const proc = commands(() => ({ code: 0, output: '' }))
    const installer = createLspInstaller({
      root: dir(),
      packages: { yaml: NPM },
      locks: {},
      run: proc.run,
      runtime: '/bin/bun',
    })
    expect(await installer.install('yaml')).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: expect.stringContaining('lockfile'),
    })
    expect(proc.calls).toEqual([])
    expect(installer.installedDir('yaml')).toBeUndefined()
  })

  test('concurrent requests share one install', async () => {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => (finish = resolve))
    let runs = 0
    const installer = createLspInstaller({
      root: dir(),
      packages: { yaml: NPM },
      locks: lockDir(),
      runtime: '/bin/bun',
      run: async () => {
        runs++
        await gate
        return { code: 0, output: '' }
      },
    })
    const both = Promise.all([installer.install('yaml'), installer.install('yaml')])
    finish()
    const [a, b] = await both
    expect(a).toEqual(b)
    expect(runs).toBe(1)
  })

  test('no network is offline, any other failure is failed, and neither looks installed', async () => {
    let output = 'error: ConnectionRefused downloading package manifest yaml-language-server'
    const installer = createLspInstaller({
      root: dir(),
      packages: { yaml: NPM },
      locks: lockDir(),
      runtime: '/bin/bun',
      run: async () => ({ code: 1, output }),
    })
    expect(await installer.install('yaml')).toMatchObject({ ok: false, reason: 'offline' })
    expect(installer.installedDir('yaml')).toBeUndefined()

    output = 'error: No version matching "2.0.0" found for specifier "yaml-language-server"'
    expect(await installer.install('yaml')).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: expect.stringContaining('No version matching'),
    })
    expect(installer.installedDir('yaml')).toBeUndefined()
  })
})

describe('a command that outlives its time', () => {
  test('fails as a timeout, not as a crash that could be an offline one', async () => {
    const installer = createLspInstaller({
      root: dir(),
      packages: { yaml: NPM },
      locks: lockDir(),
      runtime: '/bin/bun',
      // The ConnectionRefused text would read as offline if the timeout were not checked first.
      run: async () => ({ code: -1, output: 'ConnectionRefused', timedOut: true }),
    })
    expect(await installer.install('yaml')).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: expect.stringContaining('timed out'),
    })
  })
})

describe('release binaries', () => {
  const answer = (body: Uint8Array) => async () => new Response(new Blob([body as BlobPart]))

  test('a verified archive is unpacked into an executable, with download progress', async () => {
    const progress: number[] = []
    const installer = createLspInstaller({
      root: dir(),
      packages: { 'rust-analyzer': releasePackage() },
      platform: 'darwin-arm64',
      fetchImpl: answer(archive) as unknown as typeof fetch,
    })
    const outcome = await installer.install('rust-analyzer', (p) => progress.push(p))
    expect(outcome.ok).toBe(true)
    const exe = path.join(installer.installedDir('rust-analyzer')!, 'rust-analyzer')
    expect(readFileSync(exe, 'utf8')).toBe(new TextDecoder().decode(binary))
    expect(statSync(exe).mode & 0o111).not.toBe(0)
    expect(progress.at(-1)).toBe(1)
  })

  test('a download that fails its checksum installs nothing', async () => {
    const installer = createLspInstaller({
      root: dir(),
      packages: { 'rust-analyzer': releasePackage('0'.repeat(64)) },
      platform: 'darwin-arm64',
      fetchImpl: answer(archive) as unknown as typeof fetch,
    })
    expect(await installer.install('rust-analyzer')).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: expect.stringContaining('checksum'),
    })
    expect(installer.installedDir('rust-analyzer')).toBeUndefined()
  })

  test('an unreachable host is offline', async () => {
    const installer = createLspInstaller({
      root: dir(),
      packages: { 'rust-analyzer': releasePackage() },
      platform: 'darwin-arm64',
      fetchImpl: (async () => {
        throw new TypeError('Unable to connect')
      }) as unknown as typeof fetch,
    })
    expect(await installer.install('rust-analyzer')).toMatchObject({ ok: false, reason: 'offline' })
  })

  test('a stalled download is given up as offline and the next request starts afresh', async () => {
    const timers: Array<() => void> = []
    let hung!: () => void
    const stallReached = () => new Promise<void>((resolve) => (hung = resolve))
    let fetches = 0
    const installer = createLspInstaller({
      root: dir(),
      packages: { 'rust-analyzer': releasePackage() },
      platform: 'darwin-arm64',
      download: {
        stallTimeoutMs: 1,
        setTimer: (fn) => {
          timers.push(fn)
          return () => {}
        },
      },
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        fetches++
        return new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              hung()
              return new Promise<void>((_, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
              })
            },
          }),
        )
      }) as unknown as typeof fetch,
    })
    let reached = stallReached()
    const first = installer.install('rust-analyzer')
    await reached
    timers.at(-1)!()
    expect(await first).toMatchObject({ ok: false, reason: 'offline' })
    // The settled attempt left no entry behind: a later request runs its own download.
    reached = stallReached()
    const second = installer.install('rust-analyzer')
    await reached
    expect(fetches).toBe(2)
    timers.at(-1)!()
    expect(await second).toMatchObject({ ok: false, reason: 'offline' })
  })

  test('a platform without a pinned build fails with what is missing', async () => {
    const installer = createLspInstaller({
      root: dir(),
      packages: { 'rust-analyzer': releasePackage() },
      platform: 'freebsd-x64',
      fetchImpl: answer(archive) as unknown as typeof fetch,
    })
    expect(await installer.install('rust-analyzer')).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: expect.stringContaining('freebsd-x64'),
    })
  })
})

describe('toolchain servers', () => {
  test('without the toolchain the server needs it, and nothing runs', async () => {
    const proc = commands(() => ({ code: 0, output: '' }))
    const installer = createLspInstaller({
      root: dir(),
      packages: { gopls: GO },
      run: proc.run,
      which: () => undefined,
    })
    expect(await installer.install('gopls')).toEqual({
      ok: false,
      reason: 'needs-toolchain',
      detail: 'Go',
    })
    expect(proc.calls).toEqual([])
  })

  test('with the toolchain it installs the pinned module into its own bin folder', async () => {
    const proc = commands(() => ({ code: 0, output: '' }))
    const installer = createLspInstaller({
      root: dir(),
      packages: { gopls: GO },
      run: proc.run,
      which: (cmd) => (cmd === 'go' ? '/usr/local/bin/go' : undefined),
    })
    expect((await installer.install('gopls')).ok).toBe(true)
    const [call] = proc.calls
    expect([call!.command, call!.args]).toEqual([
      '/usr/local/bin/go',
      ['install', 'golang.org/x/tools/gopls@v0.24.0'],
    ])
    expect(call!.env?.GOBIN).toBe(path.join(call!.cwd, 'bin'))
  })
})

describe('older versions', () => {
  const ok = commands(() => ({ code: 0, output: '' }))
  const NOW = new Date('2026-10-27T12:00:00Z')
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

  /** A complete install of an older version, last launched `days` ago, as another process leaves it. */
  function oldInstall(root: string, version: string, days: number) {
    const old = path.join(root, 'yaml', version)
    mkdirSync(old, { recursive: true })
    writeFileSync(path.join(old, '.complete'), '')
    utimesSync(path.join(old, '.complete'), daysAgo(days), daysAgo(days))
    return old
  }
  const installer = (root: string, packages: Record<string, LspPackage> = { yaml: NPM }) =>
    createLspInstaller({
      root,
      packages,
      locks: lockDir(),
      run: ok.run,
      runtime: '/bin/bun',
      now: () => NOW,
    })

  test('a new version removes only older ones nobody has launched for a month, not staging', async () => {
    const stale = oldInstall(dir(), '1.0.0-0badc0de', 45)
    // A second Localix (dev beside a packaged build) launched this one yesterday: it is in use.
    const inUse = oldInstall(dir(), '1.5.0-0badc0de', 1)
    // Another process's install still in progress.
    mkdirSync(path.join(dir(), 'yaml', '.staging-2.0.0-x-1-0'), { recursive: true })
    const next = installer(dir())
    expect((await next.install('yaml')).ok).toBe(true)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(inUse)).toBe(true)
    expect(readdirSync(path.join(dir(), 'yaml')).sort()).toEqual([
      '.staging-2.0.0-x-1-0',
      '1.5.0-0badc0de',
      path.basename(next.installedDir('yaml')!),
    ])
  })

  test('a version this process started a server from is never removed, however old', async () => {
    const packages: Record<string, LspPackage> = {
      yaml: lspPackage('yaml', { source: 'pkg:npm/yaml-language-server@1.0.0', bin: ['y'] }),
    }
    const running = installer(dir(), packages)
    expect((await running.install('yaml')).ok).toBe(true)
    const older = running.installedDir('yaml')!
    // A server keeps running from it for months while the app updates in place.
    utimesSync(path.join(older, '.complete'), daysAgo(90), daysAgo(90))

    packages.yaml = NPM
    expect((await running.install('yaml')).ok).toBe(true)
    expect(existsSync(older)).toBe(true)

    // A process that never launched it may remove it.
    const other = installer(dir(), {
      yaml: { ...NPM, source: { ...NPM.source, version: '3.0.0' } },
    })
    expect((await other.install('yaml')).ok).toBe(true)
    expect(existsSync(older)).toBe(false)
  })

  test('launching a server marks its version used, so other processes keep it', async () => {
    const first = installer(dir())
    expect((await first.install('yaml')).ok).toBe(true)
    const dirPath = first.installedDir('yaml')!
    utimesSync(path.join(dirPath, '.complete'), daysAgo(60), daysAgo(60))
    expect(statSync(path.join(dirPath, '.complete')).mtime).toEqual(daysAgo(60))
    first.installedDir('yaml')
    expect(statSync(path.join(dirPath, '.complete')).mtime).toEqual(NOW)
  })

  test('a failed install keeps every older version', async () => {
    const old = oldInstall(dir(), '1.0.0-0badc0de', 45)
    const failing = createLspInstaller({
      root: dir(),
      packages: { yaml: NPM },
      locks: lockDir(),
      runtime: '/bin/bun',
      now: () => NOW,
      run: async () => ({ code: 1, output: 'error: something broke' }),
    })
    expect((await failing.install('yaml')).ok).toBe(false)
    expect(existsSync(old)).toBe(true)
  })
})
