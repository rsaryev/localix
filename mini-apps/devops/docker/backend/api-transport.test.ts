import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DockerTransportError, connectDockerApi } from './api-transport'
import type { HostEnvironment } from './docker-host'

/**
 * Driven against a REAL daemon stand-in on a real unix socket, not a mocked `fetch`.
 *
 * The things worth pinning here are transport facts — that the version prefix reaches the
 * wire, that a 204 is not parsed as JSON, that an absent socket is a reason rather than a
 * crash — and a stubbed `fetch` cannot be wrong about any of them in the same way the socket
 * can. Bun can both serve and fetch a unix socket, so the whole path is exercised.
 */

const servers: { stop: () => void; dir: string }[] = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
    rmSync(server.dir, { recursive: true, force: true })
  }
})

/** Start a fake daemon on a temp socket and return the env that resolves to it. */
function fakeDaemon(handler: (request: Request) => Response | Promise<Response>): HostEnvironment {
  const dir = mkdtempSync(join(tmpdir(), 'lx-docker-'))
  const socket = join(dir, 'docker.sock')
  const server = Bun.serve({ unix: socket, fetch: (request) => handler(request) })
  servers.push({ stop: () => void server.stop(true), dir })
  return {
    env: { DOCKER_HOST: `unix://${socket}` },
    platform: 'linux',
    homeDir: dir,
    readTextFile: () => null,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const VERSION = { ApiVersion: '1.55', MinAPIVersion: '1.40', Os: 'linux' }

describe('connectDockerApi', () => {
  test('negotiates a version and puts it in every request path', async () => {
    const paths: string[] = []
    const environment = fakeDaemon((request) => {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === '/version') return json(VERSION)
      return json([{ Id: 'abc' }])
    })

    const result = await connectDockerApi(environment)
    expect(result.client).not.toBeNull()
    const client = result.client!
    // Our maximum, because this daemon is newer.
    expect(client.api.version).toBe('1.44')
    expect(client.api.oneShotStats).toBe(true)

    await client.get('/containers/json')
    // `/version` is asked WITHOUT a prefix — it is the one request that cannot know the version.
    expect(paths).toEqual(['/version', '/v1.44/containers/json'])
  })

  test('an older daemon is met at its own version, and loses one-shot', async () => {
    const environment = fakeDaemon((request) =>
      new URL(request.url).pathname === '/version'
        ? json({ ApiVersion: '1.40', MinAPIVersion: '1.12', Os: 'linux' })
        : json({}),
    )
    const result = await connectDockerApi(environment)
    expect(result.client?.api).toMatchObject({ version: '1.40', oneShotStats: false })
  })

  test('a Windows daemon is flagged so the right stats formula is used', async () => {
    const environment = fakeDaemon(() => json({ ...VERSION, Os: 'windows' }))
    expect(result_windows(await connectDockerApi(environment))).toBe(true)
  })

  test('a daemon below the floor is a reason, not an exception — the CLI still works', async () => {
    const environment = fakeDaemon(() => json({ ApiVersion: '1.24', MinAPIVersion: '1.12' }))
    const result = await connectDockerApi(environment)
    expect(result.client).toBeNull()
    expect(result.client === null && result.reason).toContain('1.24')
  })

  test('a socket that is not there is a reason, not a crash', async () => {
    // Docker simply not running is the single most common state, and it must not throw.
    const result = await connectDockerApi({
      env: { DOCKER_HOST: 'unix:///tmp/definitely-not-a-docker-socket-xyz.sock' },
      platform: 'linux',
      homeDir: '/tmp',
      readTextFile: () => null,
    })
    expect(result.client).toBeNull()
    // The phrasing matches the CLI's, which `mapDockerError` already classifies as
    // `engine_unavailable` — so the sidebar's quiet empty state keeps working unchanged.
    expect(result.client === null && result.reason).toContain('Cannot connect to the Docker daemon')
  })

  test('an ssh:// endpoint reports WHY it needs the CLI, without touching the network', async () => {
    const result = await connectDockerApi({
      env: { DOCKER_HOST: 'ssh://user@builder' },
      platform: 'linux',
      homeDir: '/tmp',
      readTextFile: () => null,
    })
    expect(result.client).toBeNull()
    expect(result.client === null && result.reason).toContain('SSH')
  })

  test("the daemon's own error message is surfaced, not a generic status line", async () => {
    const environment = fakeDaemon((request) =>
      new URL(request.url).pathname === '/version'
        ? json(VERSION)
        : json({ message: 'No such container: ghost' }, 404),
    )
    const client = (await connectDockerApi(environment)).client!
    const failure = await client.get('/containers/ghost/json').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DockerTransportError)
    expect((failure as DockerTransportError).status).toBe(404)
    expect((failure as DockerTransportError).message).toBe('No such container: ghost')
  })

  test('a non-JSON error body falls back to the status instead of [object Object]', async () => {
    const environment = fakeDaemon((request) =>
      new URL(request.url).pathname === '/version'
        ? json(VERSION)
        : new Response('<html>502 gateway</html>', { status: 502 }),
    )
    const client = (await connectDockerApi(environment)).client!
    const failure = (await client
      .get('/containers/json')
      .catch((error: unknown) => error)) as DockerTransportError
    expect(failure.status).toBe(502)
    expect(failure.message).toContain('502')
  })

  test('a 204 mutation is not parsed as JSON', async () => {
    // Most Docker mutations answer 204 with an empty body; JSON-parsing that throws.
    const environment = fakeDaemon((request) =>
      new URL(request.url).pathname === '/version'
        ? json(VERSION)
        : new Response(null, { status: 204 }),
    )
    const client = (await connectDockerApi(environment)).client!
    expect(await client.post('/containers/abc/start')).toBeNull()
    await client.del('/containers/abc')
  })

  test('a hung daemon is aborted rather than hanging the workbench', async () => {
    const environment = fakeDaemon(async (request) => {
      if (new URL(request.url).pathname === '/version') return json(VERSION)
      return new Promise<Response>(() => {}) // never answers; only the abort ends it
    })
    const client = (await connectDockerApi(environment)).client!
    const started = performance.now()
    const failure = await client.get('/containers/json', { timeoutMs: 60 }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(DockerTransportError)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  test('log output is read as text, not JSON', async () => {
    const environment = fakeDaemon((request) =>
      new URL(request.url).pathname === '/version'
        ? json(VERSION)
        : new Response('line one\nline two\n'),
    )
    const client = (await connectDockerApi(environment)).client!
    expect(await client.text('/containers/abc/logs')).toBe('line one\nline two\n')
  })

  test('a raw response preserves multiplexed log bytes and headers', async () => {
    const frame = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 3, 111, 117, 116])
    const environment = fakeDaemon((request) =>
      new URL(request.url).pathname === '/version'
        ? json(VERSION)
        : new Response(frame, {
            headers: { 'content-type': 'application/vnd.docker.multiplexed-stream' },
          }),
    )
    const client = (await connectDockerApi(environment)).client!
    const response = await client.raw('/containers/abc/logs')

    expect(response.headers.get('content-type')).toBe('application/vnd.docker.multiplexed-stream')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(frame)
  })

  test('a tcp endpoint is spoken natively', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === '/version' ? json(VERSION) : json({ ok: true }),
    })
    try {
      const result = await connectDockerApi({
        env: { DOCKER_HOST: `tcp://127.0.0.1:${server.port}` },
        platform: 'linux',
        homeDir: '/tmp',
        readTextFile: () => null,
      })
      expect(result.client?.transport).toEqual({
        kind: 'tcp',
        baseUrl: `http://127.0.0.1:${server.port}`,
      })
      expect(await result.client!.get<{ ok: boolean }>('/anything')).toEqual({ ok: true })
    } finally {
      void server.stop(true)
    }
  })
})

/** Narrow the union in one place, so the Windows assertion stays readable. */
function result_windows(result: Awaited<ReturnType<typeof connectDockerApi>>): boolean | undefined {
  return result.client?.api.windows
}
