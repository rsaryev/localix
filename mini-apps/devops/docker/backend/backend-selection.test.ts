import { describe, expect, test } from 'bun:test'
import { createLazyDockerBackend, selectDockerBackend } from './backend-selection'
import type { ContainerEngineBackend } from './backend'
import type { DockerApiClient } from './api-transport'

const cli = {
  listContainers: async () => [{ id: 'cli' }],
} as unknown as ContainerEngineBackend

const client = {
  api: { version: '1.44', oneShotStats: true, windows: false },
  transport: { kind: 'unix', path: '/var/run/docker.sock' },
  get: async () => [],
} as unknown as DockerApiClient

describe('selectDockerBackend', () => {
  test('selects the Engine API implementation when a client was negotiated', async () => {
    const backend = await selectDockerBackend({
      cli,
      connect: async () => ({ client }),
    })

    expect(backend).not.toBe(cli)
    expect(await backend.listContainers()).toEqual([])
  })

  test('returns the complete CLI fallback and reports the reason at debug level', async () => {
    const messages: string[] = []
    const backend = await selectDockerBackend({
      cli,
      connect: async () => ({ client: null, reason: 'SSH transport requires Docker CLI' }),
      debug: (message) => messages.push(message),
    })

    expect(backend).toBe(cli)
    expect(messages).toEqual([
      '[devops/docker] Engine API unavailable; using CLI fallback: SSH transport requires Docker CLI',
    ])
  })
})

describe('createLazyDockerBackend', () => {
  test('a daemon started after launch is picked up once the fallback expires', async () => {
    // Chosen once at registration, a Docker Desktop that was not running yet pinned the CLI
    // fallback for the whole process.
    let clock = 0
    let daemonUp = false
    let probes = 0
    const backend = createLazyDockerBackend({
      cli,
      reprobeMs: 1_000,
      now: () => clock,
      debug: () => {},
      connect: async () => {
        probes++
        return daemonUp ? { client } : { client: null, reason: 'socket unreachable' }
      },
    })

    const list = async (): Promise<unknown> => backend.listContainers()
    expect(await list()).toEqual([{ id: 'cli' }])
    daemonUp = true
    clock = 500
    expect(await list()).toEqual([{ id: 'cli' }]) // still inside the window
    expect(probes).toBe(1)
    clock = 1_500
    expect(await backend.listContainers()).toEqual([]) // the Engine API now
    clock = 99_000
    await backend.listContainers()
    expect(probes).toBe(2) // a successful connection is kept, never re-probed
  })

  test('registration does not wait on the daemon; concurrent first calls share one probe', async () => {
    let probes = 0
    const backend = createLazyDockerBackend({
      cli,
      debug: () => {},
      connect: async () => (probes++, { client }),
    })
    expect(probes).toBe(0)
    await Promise.all([backend.listContainers(), backend.listContainers()])
    expect(probes).toBe(1)
  })
})
