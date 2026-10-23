import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertNoLiveRuntimeEndpoint,
  acquireRuntimeOwnership,
  clearRuntimeEndpoint,
  dialableRuntimeBaseUrl,
  discoverRuntimeEndpoint,
  isRuntimeEndpointLive,
  publishRuntimeEndpoint,
  readRuntimeEndpoint,
  resetRealmLeaseStateForTests,
  resolveRuntimeIdentity,
  runtimeOwnershipIsHeld,
  waitForRuntimeEndpoint,
} from './runtime-endpoint'
import { LOCALIX_API_PRODUCT_ID, LOCALIX_API_PROTOCOL_VERSION } from './runtime-protocol'

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('runtime endpoint descriptor', () => {
  test('publishes atomically and only its owner clears it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const endpoint = {
      pid: 42,
      baseUrl: 'http://127.0.0.1:5050',
      startedAt: 'now',
      protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
      instanceId: 'instance-a',
    }
    await publishRuntimeEndpoint(endpoint, file)
    expect(await readRuntimeEndpoint(file)).toEqual(endpoint)
    await clearRuntimeEndpoint(99, file)
    expect(await readRuntimeEndpoint(file)).toEqual(endpoint)
    await clearRuntimeEndpoint(42, file)
    expect(await readRuntimeEndpoint(file)).toBeNull()
    expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  test('EPERM probing a live owner remains fail-closed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          status: 'ok',
          productId: LOCALIX_API_PRODUCT_ID,
          instanceId: 'owner',
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          startedAt: 'now',
        }),
    })
    await publishRuntimeEndpoint(
      {
        pid: 4242,
        baseUrl: server.url.origin,
        startedAt: 'now',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        instanceId: 'owner',
      },
      file,
    )
    const probe = spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('not permitted') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })
    try {
      await Promise.resolve(
        expect(assertNoLiveRuntimeEndpoint(file)).rejects.toThrow('already running'),
      )
    } finally {
      probe.mockRestore()
      await server.stop(true)
    }
  })

  test('a live incompatible owner still blocks a second API process', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ status: 'ok' }) })
    await publishRuntimeEndpoint(
      {
        pid: process.pid,
        baseUrl: server.url.origin,
        startedAt: 'older-build',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION + 1,
      },
      file,
    )
    try {
      expect(assertNoLiveRuntimeEndpoint(file)).rejects.toThrow(
        `protocol ${LOCALIX_API_PROTOCOL_VERSION + 1}`,
      )
    } finally {
      await server.stop(true)
    }
  })

  test('requires a new descriptor to match the answering Localix instance', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          status: 'ok',
          productId: LOCALIX_API_PRODUCT_ID,
          instanceId: 'other-instance',
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          startedAt: 'now',
        }),
    })
    try {
      expect(
        await isRuntimeEndpointLive({
          pid: 42,
          baseUrl: server.url.origin,
          startedAt: 'now',
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          instanceId: 'expected-instance',
        }),
      ).toBe(false)
    } finally {
      await server.stop(true)
    }
  })

  test('publishes dialable loopback URLs for wildcard listen addresses', () => {
    expect(dialableRuntimeBaseUrl('0.0.0.0', 5050)).toBe('http://127.0.0.1:5050')
    expect(dialableRuntimeBaseUrl('::', 5050)).toBe('http://127.0.0.1:5050')
    expect(dialableRuntimeBaseUrl('::1', 5050)).toBe('http://[::1]:5050')
  })

  test('serializes startup and auto-reclaims a dead owner without manual removal', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const first = await acquireRuntimeOwnership('instance-a', file)
    await Promise.resolve(
      expect(acquireRuntimeOwnership('instance-b', file)).rejects.toThrow(
        `held by pid ${process.pid}`,
      ),
    )
    await first.release()

    // An unclean exit leaves a lock behind whose pid is dead; a restart must
    // reclaim it automatically rather than demand a manual file removal.
    await writeFile(`${file}.api-owner`, JSON.stringify({ pid: 2 ** 30, instanceId: 'dead' }))
    const restarted = await acquireRuntimeOwnership('instance-c', file)
    const reclaimed = JSON.parse(await readFile(`${file}.api-owner`, 'utf8')) as { pid?: number }
    expect(reclaimed.pid).toBe(process.pid)
    // A live owner still fails closed — reclamation is only ever for the dead.
    await Promise.resolve(
      expect(acquireRuntimeOwnership('instance-d', file)).rejects.toThrow(
        `held by pid ${process.pid}`,
      ),
    )
    await restarted.release()
  })

  test('concurrent acquisition has exactly one winner', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const contenders = await Promise.allSettled([
      acquireRuntimeOwnership('contender-a', file),
      acquireRuntimeOwnership('contender-b', file),
    ])
    const winners = contenders.filter((result) => result.status === 'fulfilled')
    expect(winners).toHaveLength(1)
    const winner = winners[0]
    if (winner?.status === 'fulfilled') await winner.value.release()
  })

  test('reports lease ownership without relying on PID metadata', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const databaseFile = join(dir, 'lease-status.db')
    expect(await runtimeOwnershipIsHeld(databaseFile)).toBe(false)
    const ownership = await acquireRuntimeOwnership('lease-owner', databaseFile)
    expect(await runtimeOwnershipIsHeld(databaseFile)).toBe(true)
    await ownership.release()
    expect(await runtimeOwnershipIsHeld(databaseFile)).toBe(false)
  })

  test('reclaims an incomplete legacy owner file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'localix.db')
    await writeFile(`${file}.api-owner`, '')
    const ownership = await acquireRuntimeOwnership('recovered', file)
    const owner = JSON.parse(await readFile(`${file}.api-owner`, 'utf8')) as {
      instanceId?: string
    }
    expect(owner.instanceId).toBe('recovered')
    await ownership.release()
  })

  test('ownership is scoped to the database path, not the descriptor home', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const first = await acquireRuntimeOwnership('db-a', join(dir, 'a.db'))
    const second = await acquireRuntimeOwnership('db-b', join(dir, 'b.db'))
    const home = dir
    const ownerOf = async (db: string) =>
      (JSON.parse(await readFile(join(home, `${db}.api-owner`), 'utf8')) as { instanceId?: string })
        .instanceId
    expect([await ownerOf('a.db'), await ownerOf('b.db')]).toEqual(['db-a', 'db-b'])
    await first.release()
    await second.release()
  })

  test('relative and absolute aliases resolve to one database owner', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const absolute = join(dir, 'same.db')
    const relative = join(dir, '.', 'nested', '..', 'same.db')
    const first = await acquireRuntimeOwnership('absolute', absolute)
    await Promise.resolve(
      expect(acquireRuntimeOwnership('relative', relative)).rejects.toThrow('held by pid'),
    )
    await first.release()
  })

  test('discovers only the endpoint for the selected database', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const dbA = join(dir, 'a.db')
    const dbB = join(dir, 'b.db')
    const identityA = await resolveRuntimeIdentity(dbA)
    const identityB = await resolveRuntimeIdentity(dbB)
    const serverA = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          productId: LOCALIX_API_PRODUCT_ID,
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          instanceId: 'instance-a',
          databaseId: identityA.databaseId,
        }),
    })
    const serverB = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          productId: LOCALIX_API_PRODUCT_ID,
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          instanceId: 'instance-b',
          databaseId: identityB.databaseId,
        }),
    })
    await publishRuntimeEndpoint(
      {
        pid: process.pid,
        baseUrl: serverA.url.origin,
        startedAt: 'now',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        instanceId: 'instance-a',
        databaseId: identityA.databaseId,
      },
      identityA.endpointFile,
    )
    await publishRuntimeEndpoint(
      {
        pid: process.pid,
        baseUrl: serverB.url.origin,
        startedAt: 'now',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        instanceId: 'instance-b',
        databaseId: identityB.databaseId,
      },
      identityB.endpointFile,
    )
    try {
      expect((await discoverRuntimeEndpoint({ databaseFile: dbA }))?.baseUrl).toBe(
        serverA.url.origin,
      )
      expect((await discoverRuntimeEndpoint({ databaseFile: dbB }))?.baseUrl).toBe(
        serverB.url.origin,
      )
    } finally {
      await serverA.stop(true)
      await serverB.stop(true)
    }
  })

  test('waits for the startup winner to publish its endpoint', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const databaseFile = join(dir, 'wait.db')
    const identity = await resolveRuntimeIdentity(databaseFile)
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          productId: LOCALIX_API_PRODUCT_ID,
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          instanceId: 'winner',
          databaseId: identity.databaseId,
        }),
    })
    setTimeout(() => {
      void publishRuntimeEndpoint(
        {
          pid: process.pid,
          baseUrl: server.url.origin,
          startedAt: 'now',
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          instanceId: 'winner',
          databaseId: identity.databaseId,
        },
        identity.endpointFile,
      )
    }, 30)
    try {
      const endpoint = await waitForRuntimeEndpoint({ databaseFile, timeoutMs: 5_000, pollMs: 5 })
      expect(endpoint.baseUrl).toBe(server.url.origin)
    } finally {
      await server.stop(true)
    }
  })

  test('a mismatched attestation is stale once lifecycle ownership is absent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          status: 'ok',
          productId: LOCALIX_API_PRODUCT_ID,
          instanceId: 'actual',
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          startedAt: 'now',
        }),
    })
    await publishRuntimeEndpoint(
      {
        pid: process.pid,
        baseUrl: server.url.origin,
        startedAt: 'now',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        instanceId: 'descriptor',
      },
      file,
    )
    try {
      await Promise.resolve(expect(assertNoLiveRuntimeEndpoint(file)).resolves.toBeUndefined())
    } finally {
      await server.stop(true)
    }
  })

  test('a healthy descriptor for a different database does not block startup', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          status: 'ok',
          productId: LOCALIX_API_PRODUCT_ID,
          instanceId: 'db-a-owner',
          protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
          startedAt: 'now',
          databaseId: 'database-a',
        }),
    })
    await publishRuntimeEndpoint(
      {
        pid: process.pid,
        baseUrl: server.url.origin,
        startedAt: 'now',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        instanceId: 'db-a-owner',
        databaseId: 'database-a',
      },
      file,
    )
    try {
      await Promise.resolve(
        expect(assertNoLiveRuntimeEndpoint(file, 'database-b')).resolves.toBeUndefined(),
      )
      await Promise.resolve(
        expect(assertNoLiveRuntimeEndpoint(file, 'database-a')).rejects.toThrow('already running'),
      )
    } finally {
      await server.stop(true)
    }
  })

  test('a dead descriptor does not mistake a recycled port for the old owner', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const server = Bun.serve({ port: 0, fetch: () => new Response('unrelated', { status: 200 }) })
    await publishRuntimeEndpoint(
      {
        pid: 2 ** 30,
        baseUrl: server.url.origin,
        startedAt: 'dead-owner',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        instanceId: 'dead-instance',
      },
      file,
    )
    try {
      await Promise.resolve(expect(assertNoLiveRuntimeEndpoint(file)).resolves.toBeUndefined())
    } finally {
      await server.stop(true)
    }
  })
})

/**
 * The deadlock this closes, observed while `bun run dev` sat forever on
 * "Waiting for your frontend dev server to start on http://localhost:5050/":
 *
 *  - `ownerIsLive` decides ownership from PID liveness; `discoverRuntimeEndpoint` requires an HTTP
 *    answer. A `bun --watch` API whose reloaded module throws at import time keeps its process and
 *    loses its server, so it satisfies the first and fails the second — forever.
 *  - Every later start was therefore told "ownership held", polled 40s for an endpoint that could
 *    never appear, and died. The dev launcher waits for API health before starting the frontend, so
 *    nothing ever reached port 5050.
 *
 * Evidence from the real machine: descriptor `{pid: 99068, baseUrl: "http://127.0.0.1:5051"}` with
 * pid 99068 alive (`bun --watch …/apps/api/src/index.ts`) and holding NO listening socket.
 */
describe('watch-reload ownership + actionable timeout', () => {
  test('the timeout message names the descriptor and the holder', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const identity = await resolveRuntimeIdentity(file)
    await publishRuntimeEndpoint(
      {
        pid: process.pid,
        baseUrl: 'http://127.0.0.1:1',
        startedAt: 'now',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        instanceId: 'instance-stuck',
        databaseId: identity.databaseId,
      },
      identity.endpointFile,
    )
    const failure = await waitForRuntimeEndpoint({
      databaseFile: file,
      timeoutMs: 50,
      pollMs: 10,
    }).then(
      () => null,
      (error: unknown) => error as Error,
    )
    // The old message carried only a database id — nothing a user staring at a stuck launcher could
    // act on.
    expect(failure?.message).toContain(identity.endpointFile)
    expect(failure?.message).toContain(`pid ${process.pid}`)
    expect(failure?.message).toContain('alive but not answering')
  })

  test('a same-realm second acquisition is still refused — only a fresh realm may take over', async () => {
    // The invariant the two pre-existing tests encode, restated here as the guard on the reload
    // bypass: within ONE module realm a second acquire must fail, or two servers could own a
    // database inside one process. `realmTookLease` is what separates that from a watch reload,
    // whose realm is brand new.
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const held = await acquireRuntimeOwnership('instance-a', file)
    await Promise.resolve(
      expect(acquireRuntimeOwnership('instance-b', file)).rejects.toThrow(
        `held by pid ${process.pid}`,
      ),
    )
    await held.release()
    // Released: a later acquire takes the lease normally, no bypass involved.
    const again = await acquireRuntimeOwnership('instance-c', file)
    await again.release()
  })

  test('a fresh realm takes over a lease its own pid still nominally owns (watch reload)', async () => {
    // The reload state, reproduced: the lease is held by a holder this realm cannot reach, while the
    // lock file names THIS pid — which is what `bun --watch` leaves behind, since it re-evaluates the
    // module graph in the same process (pid identical across reloads, `globalThis` reset). Held here
    // by a child process so the lease is genuinely BUSY for us, with the lock rewritten to our pid.
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const file = join(dir, 'api-runtime.json')
    const identity = await resolveRuntimeIdentity(file)
    const holder = Bun.spawn(
      [
        'bun',
        '-e',
        `const { Database } = require('bun:sqlite');` +
          `const db = new Database(${JSON.stringify(identity.leaseFile)}, { create: true });` +
          `db.exec('PRAGMA busy_timeout = 0'); db.exec('BEGIN EXCLUSIVE');` +
          `console.log('held'); setInterval(() => {}, 1000);`,
      ],
      { stdout: 'pipe' },
    )
    try {
      // Wait for the child to actually hold the transaction.
      const reader = holder.stdout.getReader()
      await reader.read()
      reader.releaseLock()

      await writeFile(
        identity.lockFile,
        JSON.stringify({ pid: process.pid, instanceId: 'previous-realm' }),
      )
      // Earlier tests in this process already took the lease, which correctly disables the bypass.
      // A real reload gets a fresh realm; this is the only way to reproduce that here.
      resetRealmLeaseStateForTests()
      // Without the bypass this throws RuntimeOwnershipHeldError, `startOrAttachServer` then polls
      // 40s for an endpoint that never appears, and `bun run dev` never starts the frontend.
      const taken = await acquireRuntimeOwnership('reloaded-realm', file)
      const lock = JSON.parse(await readFile(identity.lockFile, 'utf8')) as { instanceId?: string }
      expect(lock.instanceId).toBe('reloaded-realm')
      // Releasing must not touch the transaction this run never opened.
      await taken.release()
    } finally {
      holder.kill()
      await holder.exited
    }
  })
})

/**
 * A holder that owns the lease in ANOTHER process, with a lock file it wrote itself —
 * start token included, so it is indistinguishable from a real runtime. `serve: true`
 * additionally answers `/health` as a healthy Localix instance and publishes the matching
 * descriptor.
 */
function spawnForeignHolder(
  identity: Awaited<ReturnType<typeof resolveRuntimeIdentity>>,
  serve: boolean,
) {
  const health = JSON.stringify({
    status: 'ok',
    productId: LOCALIX_API_PRODUCT_ID,
    instanceId: 'foreign-holder',
    protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
    startedAt: 'now',
    // Must match the descriptor: `isRuntimeEndpointLive` compares them, so a health
    // answer without it reads as "a different database" and the holder as wedged.
    databaseId: identity.databaseId,
  })
  return Bun.spawn(
    [
      'bun',
      '-e',
      `const { Database } = require('bun:sqlite');` +
        `const { execFileSync } = require('node:child_process');` +
        `const { writeFileSync } = require('node:fs');` +
        `const db = new Database(${JSON.stringify(identity.leaseFile)}, { create: true });` +
        `db.exec('PRAGMA busy_timeout = 0'); db.exec('BEGIN EXCLUSIVE');` +
        `const startToken = execFileSync('ps', ['-o','lstart=','-p',String(process.pid)], { encoding: 'utf8' }).trim() || null;` +
        `writeFileSync(${JSON.stringify(identity.lockFile)}, JSON.stringify({ pid: process.pid, instanceId: 'foreign-holder', startToken }) + '\\n');` +
        (serve
          ? `const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json(${health}) });` +
            `writeFileSync(${JSON.stringify(identity.endpointFile)}, JSON.stringify({ pid: process.pid, baseUrl: 'http://127.0.0.1:' + server.port, startedAt: 'now', protocolVersion: ${LOCALIX_API_PROTOCOL_VERSION}, instanceId: 'foreign-holder', databaseId: ${JSON.stringify(identity.databaseId)} }) + '\\n');`
          : '') +
        `console.log('held'); setInterval(() => {}, 1000);`,
    ],
    { stdout: 'pipe' },
  )
}

async function awaitHeld(holder: ReturnType<typeof Bun.spawn>): Promise<void> {
  const stdout = holder.stdout
  if (!stdout || typeof stdout === 'number') {
    throw new Error('Ownership-holder fixture stdout is not piped')
  }
  const reader = stdout.getReader()
  await reader.read()
  reader.releaseLock()
}

// `ps -o lstart=` is the attestation the reclaim requires, and it does not exist on
// Windows — there the conflict is reported instead of resolved, so these cases are POSIX.
const posix = process.platform !== 'win32'

describe('reclaiming a wedged ownership holder', () => {
  test.skipIf(!posix)('a holder that no longer serves is taken over, not waited on', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const identity = await resolveRuntimeIdentity(join(dir, 'localix.db'))
    const holder = spawnForeignHolder(identity, false)
    try {
      await awaitHeld(holder)
      resetRealmLeaseStateForTests()

      // Before this existed, the call below threw and the caller then polled for 40s for
      // an endpoint that could never appear — the state only `rm -rf ~/.localix` cleared.
      const taken = await acquireRuntimeOwnership('successor', identity.databaseFile)
      expect(await holder.exited).not.toBe(0)
      const lock = JSON.parse(await readFile(identity.lockFile, 'utf8')) as { instanceId?: string }
      expect(lock.instanceId).toBe('successor')
      await taken.release()
    } finally {
      holder.kill()
      await holder.exited
    }
  })

  test.skipIf(!posix)('a healthy holder is attached to, never killed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const identity = await resolveRuntimeIdentity(join(dir, 'localix.db'))
    const holder = spawnForeignHolder(identity, true)
    try {
      await awaitHeld(holder)
      resetRealmLeaseStateForTests()

      await Promise.resolve(
        expect(acquireRuntimeOwnership('successor', identity.databaseFile)).rejects.toThrow(
          'ownership is held',
        ),
      )
      // Serving means "a real owner", and a real owner is attached to by the caller.
      expect(holder.killed).toBe(false)
      expect(await isRuntimeEndpointLive((await readRuntimeEndpoint(identity.endpointFile))!)).toBe(
        true,
      )
    } finally {
      holder.kill()
      await holder.exited
    }
  })

  test.skipIf(!posix)('a recycled pid is refused, not signalled', async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-api-runtime-'))
    const identity = await resolveRuntimeIdentity(join(dir, 'localix.db'))
    const holder = spawnForeignHolder(identity, false)
    try {
      await awaitHeld(holder)
      // The dangerous shape: the lock names a pid that IS alive, but the process at that
      // number is not the one that wrote the lock. Killing it would kill a stranger.
      await writeFile(
        identity.lockFile,
        `${JSON.stringify({
          pid: holder.pid,
          instanceId: 'foreign-holder',
          startToken: 'Thu Jan  1 00:00:00 1970',
        })}\n`,
      )
      resetRealmLeaseStateForTests()

      await Promise.resolve(
        expect(acquireRuntimeOwnership('successor', identity.databaseFile)).rejects.toThrow(
          'ownership is held',
        ),
      )
      expect(holder.killed).toBe(false)
    } finally {
      holder.kill()
      await holder.exited
    }
  })
})
