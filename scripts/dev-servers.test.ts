import { describe, expect, test } from 'bun:test'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveRuntimeIdentity } from '../apps/api/src/lib/runtime-endpoint'
import { parseUiOrigins } from '../apps/api/src/lib/local-origin-guard'

import {
  devUiOrigins,
  assertDevelopmentRuntimeAvailable,
  exitCode,
  observeChildProcess,
  resolveDevTurboCommands,
  waitForHealth,
  assertFrontendPortAvailable,
  assertApiPortAvailable,
  busyLoopbackAddress,
  ensureDependenciesInstalled,
  resolveDevDatabaseFile,
} from './dev-servers.mjs'

class FakeChild extends EventEmitter {}

describe('isolated web development', () => {
  test('defaults to a persistent checkout-local database, not the installed app database', () => {
    expect(resolveDevDatabaseFile({}, '/checkout')).toBe(
      resolve('/checkout', '.data/dev/localix.db'),
    )
    expect(resolveDevDatabaseFile({ LOCALIX_DB_FILE: '  ' }, '/checkout')).toBe(
      resolve('/checkout', '.data/dev/localix.db'),
    )
  })

  test('preserves an explicit database override', () => {
    expect(resolveDevDatabaseFile({ LOCALIX_DB_FILE: ' /custom/dev.db ' })).toBe('/custom/dev.db')
  })

  test('selects the isolated database before the ownership preflight', () => {
    const source = readFileSync(resolve(import.meta.dir, 'dev-servers.mjs'), 'utf8')
    const body = source.slice(source.indexOf('export async function runDevServers'))
    expect(body.indexOf('process.env.LOCALIX_DB_FILE = resolveDevDatabaseFile()')).toBeLessThan(
      body.indexOf('await assertDevelopmentRuntimeAvailable()'),
    )
    const config = JSON.parse(readFileSync(resolve(import.meta.dir, '../turbo.json'), 'utf8'))
    expect(config.tasks.dev.passThroughEnv).toContain('LOCALIX_*')
    expect(config.tasks.dev.passThroughEnv).toContain('VITE_*')
  })

  test('both dev processes override an inherited production environment', () => {
    const source = readFileSync(resolve(import.meta.dir, 'dev-servers.mjs'), 'utf8')
    const body = source.slice(source.indexOf('export async function runDevServers'))
    for (const child of ['api', 'frontend']) {
      const start = body.indexOf(`const ${child} = spawn(`)
      const end = body.indexOf(`children.add(${child})`, start)
      expect(body.slice(start, end)).toMatch(/\.\.\.process\.env,[\s\S]*NODE_ENV: 'development'/)
    }
  })
})

describe('dev server child lifecycle', () => {
  test('an exit remains observable even when the steady-state waiter attaches later', async () => {
    const child = new FakeChild()
    const observer = observeChildProcess(child, 'api')
    child.emit('exit', 7, null)

    expect(await observer.exited).toEqual({
      code: 7,
      signal: null,
      error: null,
      label: 'api',
    })
    expect(observer.outcome()).toEqual({
      code: 7,
      signal: null,
      error: null,
      label: 'api',
    })
  })

  test('spawn errors settle the same observer instead of becoming unhandled events', async () => {
    const child = new FakeChild()
    const observer = observeChildProcess(child, 'frontend')
    const error = new Error('ENOENT')
    child.emit('error', error)

    expect(await observer.exited).toEqual({
      code: null,
      signal: null,
      error,
      label: 'frontend',
    })
  })

  test('maps signal-only exits to conventional shell codes', () => {
    expect(exitCode(null, 'SIGINT')).toBe(130)
    expect(exitCode(null, 'SIGTERM')).toBe(143)
    expect(exitCode(null, 'SIGKILL')).toBe(1)
  })
})

describe('development Turbo orchestration', () => {
  test('prepares shared dependencies once before isolated persistent tasks start', () => {
    const commands = resolveDevTurboCommands(false)

    expect(commands.prepare).toEqual([
      'x',
      'turbo',
      'dev:prepare',
      '--output-logs=new-only',
      '--filter=@localixai/api',
      '--filter=@localixai/ui',
      '--filter=@localixai/agent',
      '--filter=@localixai/engine...',
    ])
    expect(commands.api).toEqual(['x', 'turbo', 'dev', '--only', '--filter=@localixai/api'])
    expect(commands.frontend).toContain('--only')
  })

  test('workspace preparation covers both the API and the remaining workspace', () => {
    const commands = resolveDevTurboCommands(true)

    expect(commands.prepare).toEqual([
      'x',
      'turbo',
      'dev:prepare',
      '--output-logs=new-only',
      '--filter=@localixai/api',
      '--filter=!@localixai/api',
    ])
    expect(commands.frontend).toEqual([
      'x',
      'turbo',
      'dev',
      '--only',
      '--concurrency=64',
      '--filter=!@localixai/api',
    ])
  })
})

describe('the launcher actually runs its preflights', () => {
  /**
   * `runDevServers` spawns Turbo, so it cannot be driven in a unit test — and removing
   * `await assertFrontendPortAvailable()` from it left all fourteen tests here green while
   * restoring the exact failure the check exists for. The check being correct is not the same
   * claim as the launcher calling it.
   *
   * Asserted on the source because the invariant IS structural: it is about the call existing,
   * before either half of the app is spawned.
   */
  const launcher = readFileSync(resolve(import.meta.dir, 'dev-servers.mjs'), 'utf8')
  const body = launcher.slice(launcher.indexOf('export async function runDevServers'))
  const at = (needle: string) => body.indexOf(needle)

  test('all three preflights run', () => {
    expect(at('await assertDevelopmentRuntimeAvailable()')).toBeGreaterThan(-1)
    expect(at('await assertFrontendPortAvailable()')).toBeGreaterThan(-1)
    // The API half had no port preflight at all, which is the asymmetry the frontend one
    // exists to prevent: a foreign listener on 5051 passed every check and then failed
    // with a raw EADDRINUSE after the slow dependency build, taking Turbo down with it.
    expect(at('await assertApiPortAvailable(port)')).toBeGreaterThan(-1)
  })

  test('they run BEFORE anything is spawned', () => {
    // The whole value is refusing early: a preflight after the first spawn still leaves a
    // half-started graph for Turbo to tear down.
    expect(at('await assertFrontendPortAvailable()')).toBeLessThan(at("spawn('bun'"))
    expect(at('await assertApiPortAvailable(port)')).toBeLessThan(at("spawn('bun'"))
    // A stale install must be brought up to the lockfile before the first build reads it.
    expect(at('ensureDependenciesInstalled()')).toBeGreaterThan(-1)
    expect(at('ensureDependenciesInstalled()')).toBeLessThan(at("spawn('bun'"))
  })

  // The API trusts only the page origins it is told about; a launcher that stops naming its Vite
  // origin leaves the dev UI with a 403 on every write and a refused websocket.
  test('the API child is told the dev UI origin', () => {
    expect(at('LOCALIX_UI_ORIGINS: devUiOrigins()')).toBeGreaterThan(-1)
  })

  test('the search really can fail — otherwise the two above pass on any file', () => {
    expect(at('await assertNothingLikeThisExists()')).toBe(-1)
  })
})

describe('dev UI origins', () => {
  test('names both loopback spellings of the exact Vite port, never a wildcard', () => {
    expect(devUiOrigins(5050)).toBe('http://localhost:5050,http://127.0.0.1:5050')
    expect(devUiOrigins(6123)).not.toContain('*')
  })

  test('is accepted by the API origin parser as it is written', () => {
    expect(parseUiOrigins(devUiOrigins(5050))).toEqual([
      'http://localhost:5050',
      'http://127.0.0.1:5050',
    ])
  })
})

describe('dependency preflight', () => {
  const runner =
    (result: { status: number | null; stdout?: string; stderr?: string; error?: Error }) =>
    (file: string, args: string[]) => {
      calls.push([file, ...args].join(' '))
      return result
    }
  let calls: string[] = []

  test('installs exactly the lockfile, never rewriting it, and is silent when it succeeds', () => {
    calls = []
    const logged: string[] = []
    const ok = ensureDependenciesInstalled({
      // What bun prints on EVERY run, whether or not anything was missing.
      run: runner({ status: 0, stdout: 'bun install v1.3.14\n\n1 package installed [66ms]\n' }),
      log: (line: string) => logged.push(line),
    })
    expect(ok).toBe(true)
    expect(calls).toEqual(['bun install --frozen-lockfile'])
    expect(logged).toEqual([])
  })

  test('a failed install is reported and does not stop development', () => {
    const logged: string[] = []
    const ok = ensureDependenciesInstalled({
      run: runner({ status: 1, stderr: 'error: lockfile had changes, but lockfile is frozen' }),
      log: (line: string) => logged.push(line),
    })
    expect(ok).toBe(false)
    expect(logged[0]).toContain('lockfile had changes')
    expect(logged[0]).toContain('run `bun install` yourself')
  })
})

describe('frontend port preflight', () => {
  /**
   * The conflict that actually takes the dev group down.
   *
   * `assertDevelopmentRuntimeAvailable` promises to catch conflicts "before spawning either half of
   * the app" but only checks the API's database owner. A stale Vite from an earlier session passes
   * it, then fails with EADDRINUSE, and Turbo tears down the whole graph — API and Tauri with it.
   *
   * The probe must try BOTH loopback addresses. Measured: with a listener on `[::1]`, binding
   * `127.0.0.1`, `::`, or no host at all all report the port FREE. Vite resolves `localhost` and on
   * macOS reaches `::1` first, so a one-address probe is a guard that cannot see its own conflict.
   */
  const listenOn = async (host: string, port: number) => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen({ host, port }, () => resolve()))
    return () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const freePort = async () => {
    const probe = net.createServer()
    await new Promise<void>((resolve) =>
      probe.listen({ host: '127.0.0.1', port: 0 }, () => resolve()),
    )
    const { port } = probe.address() as { port: number }
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    return port
  }

  test('an unused port is startable', async () => {
    expect(await busyLoopbackAddress(await freePort())).toBeNull()
  })

  test('an IPv6-only holder is detected — the case a 127.0.0.1 probe misses', async () => {
    const port = await freePort()
    const close = await listenOn('::1', port)
    try {
      expect(await busyLoopbackAddress(port)).toBe('::1')
      expect(assertFrontendPortAvailable(port)).rejects.toThrow(/already in use on ::1/)
    } finally {
      await close()
    }
  })

  test('an IPv4 holder is detected too', async () => {
    const port = await freePort()
    const close = await listenOn('127.0.0.1', port)
    try {
      expect(await busyLoopbackAddress(port)).toBe('127.0.0.1')
    } finally {
      await close()
    }
  })

  test('a bind that fails for any OTHER reason is not a conflict', async () => {
    // A host with no IPv6 answers EADDRNOTAVAIL / EAFNOSUPPORT for `::1`. Refusing to launch over
    // that would be worse than the conflict this guard exists for, so only EADDRINUSE counts.
    // 192.0.2.0/24 is TEST-NET-1: never assigned to an interface, so the bind fails without
    // anything listening there.
    expect(await busyLoopbackAddress(await freePort(), ['192.0.2.1'])).toBeNull()
  })

  test('the message names the port and how to find the process', async () => {
    const port = await freePort()
    const close = await listenOn('127.0.0.1', port)
    try {
      expect(assertFrontendPortAvailable(port)).rejects.toThrow(
        new RegExp(`lsof -nP -iTCP:${port}`),
      )
    } finally {
      await close()
    }
  })

  test('the API port gets the same guard, and says which half it is about', async () => {
    const port = await freePort()
    const close = await listenOn('127.0.0.1', port)
    try {
      await Promise.resolve(
        expect(assertApiPortAvailable(port)).rejects.toThrow(
          new RegExp(`API port ${port} is already in use`),
        ),
      )
    } finally {
      await close()
    }
  })
})

describe('development runtime preflight', () => {
  test('rejects an alive database owner before either half of the app starts', async () => {
    const previous = process.env.LOCALIX_DB_FILE
    const dir = await mkdtemp(join(tmpdir(), 'localix-preflight-'))
    process.env.LOCALIX_DB_FILE = join(dir, 'localix.db')
    try {
      const identity = await resolveRuntimeIdentity()
      await writeFile(
        identity.endpointFile,
        JSON.stringify({
          pid: process.pid,
          baseUrl: 'http://127.0.0.1:1',
          startedAt: 'now',
          protocolVersion: 4,
          instanceId: 'stuck',
          databaseId: identity.databaseId,
        }),
      )

      const failure = await assertDevelopmentRuntimeAvailable().then(
        () => null,
        (error: unknown) => error as Error,
      )
      expect(failure?.message).toContain('Cannot start Localix development')
      expect(failure?.message).toContain(`pid ${process.pid}`)
      expect(failure?.message).toContain('alive but not responding')
      expect(failure?.message).toContain('Quit the other Localix app/runtime')
    } finally {
      if (previous === undefined) delete process.env.LOCALIX_DB_FILE
      else process.env.LOCALIX_DB_FILE = previous
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('ignores a descriptor whose process no longer exists', async () => {
    const previous = process.env.LOCALIX_DB_FILE
    const dir = await mkdtemp(join(tmpdir(), 'localix-preflight-'))
    process.env.LOCALIX_DB_FILE = join(dir, 'localix.db')
    try {
      const identity = await resolveRuntimeIdentity()
      await writeFile(
        identity.endpointFile,
        JSON.stringify({
          pid: 2_147_483_647,
          baseUrl: 'http://127.0.0.1:1',
          startedAt: 'now',
          protocolVersion: 4,
          instanceId: 'gone',
          databaseId: identity.databaseId,
        }),
      )
      expect(await assertDevelopmentRuntimeAvailable()).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.LOCALIX_DB_FILE
      else process.env.LOCALIX_DB_FILE = previous
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/**
 * Backend readiness is diagnosed independently from frontend startup. The UI is
 * already running when this timeout fires and can present the backend failure.
 */
describe('API health timeout diagnosis', () => {
  const neverExits = { exited: new Promise<never>(() => {}), outcome: () => undefined }

  test('names the descriptor and holder while confirming frontend independence', async () => {
    // Hermetic: point the runtime at a temp database, or discovery finds the developer's OWN running
    // API on this machine, `/health` answers, and the wait succeeds instead of timing out — the test
    // would then pass or fail depending on whether `bun run dev` happens to be up.
    const previous = process.env.LOCALIX_DB_FILE
    const dir = await mkdtemp(join(tmpdir(), 'localix-devservers-'))
    process.env.LOCALIX_DB_FILE = join(dir, 'localix.db')
    try {
      // A live descriptor naming THIS process: alive, and answering nothing — the exact shape that
      // produced the reported hang.
      const identity = await resolveRuntimeIdentity()
      await writeFile(
        identity.endpointFile,
        JSON.stringify({
          pid: process.pid,
          baseUrl: 'http://127.0.0.1:1',
          startedAt: 'now',
          protocolVersion: 4,
          instanceId: 'stuck',
          databaseId: identity.databaseId,
        }),
      )
      // Port 1 is closed, so /health never answers and the wait runs to its (tiny) timeout.
      const failure = await waitForHealth('http://127.0.0.1:1', neverExits, 150).then(
        () => null,
        (error: unknown) => error as Error,
      )
      expect(failure).not.toBeNull()
      const message = failure!.message
      expect(message).toContain('Timed out after 150ms')
      expect(message).toContain(identity.endpointFile)
      expect(message).toContain(`pid ${process.pid}`)
      expect(message).toContain('ALIVE but not answering')
      expect(message).toContain('frontend was started independently')
    } finally {
      if (previous === undefined) delete process.env.LOCALIX_DB_FILE
      else process.env.LOCALIX_DB_FILE = previous
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an API that exits before readiness is reported as an exit, not as a timeout', async () => {
    // The other branch, unchanged: when the child dies the observer's outcome wins, so the message
    // names the exit code instead of blaming the wait.
    const exited = {
      exited: Promise.resolve({ code: 1, signal: null, error: null, label: 'api' }),
      outcome: () => ({ code: 1, signal: null, error: null, label: 'api' }),
    }
    const failure = await waitForHealth('http://127.0.0.1:1', exited, 150).then(
      () => null,
      (error: unknown) => error as Error,
    )
    expect(failure?.message).toContain('exited before readiness')
    expect(failure?.message).toContain('code=1')
  })
})
