import { describe, expect, test } from 'bun:test'
import { createDockerApiBackend } from './api-backend'
import type { ContainerEngineBackend } from './backend'
import { DockerTransportError, type DockerApiClient } from './api-transport'

interface RequestRecord {
  method: 'GET' | 'POST' | 'DELETE' | 'RAW'
  path: string
  options?: unknown
}

function fakeClient(
  responses: Record<string, unknown> = {},
  records: RequestRecord[] = [],
): DockerApiClient {
  const responseFor = (path: string): unknown => {
    const value = responses[path]
    if (value instanceof Error) throw value
    return value
  }
  return {
    api: { version: '1.44', oneShotStats: true, windows: false },
    transport: { kind: 'unix', path: '/tmp/docker.sock' },
    async get<T>(path: string, options?: { timeoutMs?: number }) {
      records.push({ method: 'GET', path, options })
      return responseFor(path) as T
    },
    async post<T>(path: string, options?: { body?: unknown; timeoutMs?: number }) {
      records.push({ method: 'POST', path, options })
      return (responseFor(path) ?? null) as T | null
    },
    async del(path, options) {
      records.push({ method: 'DELETE', path, options })
      responseFor(path)
    },
    async text(path, options) {
      records.push({ method: 'GET', path, options })
      const response = responseFor(path)
      return typeof response === 'string' ? response : ''
    },
    async raw(path, options) {
      records.push({ method: 'RAW', path, options })
      return responseFor(path) as Response
    },
  }
}

function fakeCli(overrides: Partial<ContainerEngineBackend> = {}): ContainerEngineBackend {
  return {
    listContainers: async () => [],
    listImages: async () => [],
    listVolumes: async () => [],
    listNetworks: async () => [],
    containerLogs: async (id) => ({ id, lines: '' }),
    containerStats: async () => null,
    containerTop: async () => ({ headers: [], processes: [] }),
    startContainer: async () => {},
    stopContainer: async () => {},
    restartContainer: async () => {},
    removeContainer: async () => {},
    removeImage: async () => {},
    removeVolume: async () => {},
    removeNetwork: async () => {},
    prune: async (target) => ({ target, output: '' }),
    composeAvailable: async () => false,
    composeUp: async () => {},
    ...overrides,
  }
}

describe('createDockerApiBackend', () => {
  test('lists every resource through the Engine API and maps the stable contracts', async () => {
    const records: RequestRecord[] = []
    const client = fakeClient(
      {
        '/containers/json?all=1': [{ Id: 'c1', Names: ['/api'], State: 'running' }],
        '/images/json': [{ Id: 'sha256:i1', RepoTags: ['api:dev'], Size: 1_200, Created: 1 }],
        '/volumes': { Volumes: [{ Name: 'data', Driver: 'local', Scope: 'local' }] },
        '/networks': [{ Id: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' }],
      },
      records,
    )
    const backend = createDockerApiBackend({ client, cli: fakeCli() })

    expect(await backend.listContainers()).toMatchObject([{ id: 'c1', name: 'api' }])
    expect(await backend.listImages()).toMatchObject([
      { id: 'sha256:i1', repository: 'api', tag: 'dev', size: '1.2kB' },
    ])
    expect(await backend.listVolumes()).toEqual([{ name: 'data', driver: 'local', scope: 'local' }])
    expect(await backend.listNetworks()).toEqual([
      { id: 'n1', name: 'bridge', driver: 'bridge', scope: 'local' },
    ])
    expect(records.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/containers/json?all=1'],
      ['GET', '/images/json'],
      ['GET', '/volumes'],
      ['GET', '/networks'],
    ])
  })

  test('reads one-shot stats and derives CPU from the retained previous sample', async () => {
    const path = '/containers/c1/stats?stream=false&one-shot=true'
    let total = 100
    const records: RequestRecord[] = []
    const client = fakeClient({}, records)
    client.get = async <T>(requestPath: string, options?: { timeoutMs?: number }) => {
      records.push({ method: 'GET', path: requestPath, options })
      const sample = {
        cpu_stats: {
          cpu_usage: { total_usage: total },
          system_cpu_usage: total === 100 ? 1_000 : 1_100,
          online_cpus: 2,
        },
        memory_stats: { usage: 50, limit: 100, stats: {} },
        pids_stats: { current: 2 },
      }
      total += 50
      return sample as T
    }
    const backend = createDockerApiBackend({ client, cli: fakeCli() })

    expect((await backend.containerStats('c1'))?.cpuPct).toBe(0)
    expect((await backend.containerStats('c1'))?.cpuPct).toBe(100)
    expect(records.map((record) => record.path)).toEqual([path, path])
    expect(records[0]?.options).toEqual({ timeoutMs: 15_000 })
  })

  test('treats the daemon stopped-container conflict as an empty stats sample', async () => {
    const client = fakeClient({
      '/containers/stopped/stats?stream=false&one-shot=true': new DockerTransportError(
        'Container stopped is not running',
        409,
      ),
    })
    const backend = createDockerApiBackend({ client, cli: fakeCli() })

    expect(await backend.containerStats('stopped')).toBeNull()
  })

  test('reads framed logs raw and sends an absolute UNIX since timestamp', async () => {
    const bytes = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 4, 108, 111, 103, 10])
    const path = '/containers/a%2Fb/logs?stdout=1&stderr=1&timestamps=1&tail=50&since=1720000090'
    const records: RequestRecord[] = []
    const client = fakeClient(
      {
        [path]: new Response(bytes, {
          headers: { 'content-type': 'application/vnd.docker.multiplexed-stream' },
        }),
      },
      records,
    )
    const backend = createDockerApiBackend({
      client,
      cli: fakeCli(),
      now: () => 1_720_000_100_000,
    })

    expect(await backend.containerLogs('a/b', 50, 10)).toEqual({ id: 'a/b', lines: 'log\n' })
    expect(records).toMatchObject([{ method: 'RAW', path }])
  })

  test('maps top and sends lifecycle/removal methods to the documented endpoints', async () => {
    const records: RequestRecord[] = []
    const client = fakeClient(
      {
        '/containers/c1/top': { Titles: ['PID', 'CMD'], Processes: [['1', 'sleep']] },
      },
      records,
    )
    const backend = createDockerApiBackend({ client, cli: fakeCli() })

    expect(await backend.containerTop('c1')).toEqual({
      headers: ['PID', 'CMD'],
      processes: [['1', 'sleep']],
    })
    await backend.startContainer('c1')
    await backend.stopContainer('c1')
    await backend.restartContainer('c1')
    await backend.removeContainer('c1', true)
    await backend.removeImage('sha256:i', false)
    await backend.removeVolume('data volume', true)
    await backend.removeNetwork('n1')

    expect(records).toMatchObject([
      { method: 'GET', path: '/containers/c1/top' },
      { method: 'POST', path: '/containers/c1/start' },
      { method: 'POST', path: '/containers/c1/stop', options: { timeoutMs: 30_000 } },
      { method: 'POST', path: '/containers/c1/restart', options: { timeoutMs: 30_000 } },
      { method: 'DELETE', path: '/containers/c1?force=true' },
      { method: 'DELETE', path: '/images/sha256%3Ai?force=false' },
      { method: 'DELETE', path: '/volumes/data%20volume?force=true' },
      { method: 'DELETE', path: '/networks/n1' },
    ])
  })

  test('summarizes every prune response shape', async () => {
    const client = fakeClient({
      '/containers/prune': { ContainersDeleted: ['a', 'b'], SpaceReclaimed: 1_200 },
      '/images/prune': { ImagesDeleted: [{ Deleted: 'x' }], SpaceReclaimed: 0 },
      '/volumes/prune': { VolumesDeleted: ['data'], SpaceReclaimed: 5_000 },
      '/networks/prune': { NetworksDeleted: ['old'] },
    })
    const backend = createDockerApiBackend({ client, cli: fakeCli() })

    expect(await backend.prune('containers')).toEqual({
      target: 'containers',
      output: 'Deleted 2 containers; reclaimed 1.2kB.',
    })
    expect((await backend.prune('images')).output).toBe('Deleted 1 images; reclaimed 0B.')
    expect((await backend.prune('volumes')).output).toBe('Deleted 1 volumes; reclaimed 5kB.')
    expect((await backend.prune('networks')).output).toBe('Deleted 1 networks; reclaimed 0B.')
  })

  test('delegates only Compose calls to the CLI backend', async () => {
    const calls: string[] = []
    const cli = fakeCli({
      composeAvailable: async () => {
        calls.push('available')
        return true
      },
      composeUp: async (project) => {
        calls.push(`up:${project}`)
      },
    })
    const backend = createDockerApiBackend({ client: fakeClient(), cli })

    expect(await backend.composeAvailable()).toBe(true)
    await backend.composeUp('demo')
    expect(calls).toEqual(['available', 'up:demo'])
  })

  test('maps transport failures to the existing typed Docker errors', async () => {
    const client = fakeClient({
      '/images/json': new DockerTransportError(
        'Cannot connect to the Docker daemon at /tmp/docker.sock',
        0,
      ),
    })
    const backend = createDockerApiBackend({ client, cli: fakeCli() })
    const error = await backend.listImages().catch((cause: unknown) => cause)

    expect(error).toMatchObject({ name: 'DockerError', code: 'engine_unavailable' })
  })
})
