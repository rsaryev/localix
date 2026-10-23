import { describe, expect, test } from 'bun:test'
import { createDockerResourceProvider, type ResourceDockerService } from './resource-provider'
import type {
  ContainerLogs,
  ContainerStats,
  ContainerTop,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from './contracts'

const container: DockerContainer = {
  id: 'abc123def456',
  name: 'pg',
  image: 'postgres:16',
  state: 'running',
  status: 'Up 3 hours',
  ports: '0.0.0.0:5432->5432/tcp',
  createdAt: '2026-07-01',
}

const image: DockerImage = {
  id: 'sha256img01',
  repository: 'postgres',
  tag: '16',
  size: '142MB',
  createdAt: '2026-06-30',
}
const volume: DockerVolume = { name: 'pgdata', driver: 'local', scope: 'local' }
const network: DockerNetwork = { id: 'netid01', name: 'app-net', driver: 'bridge', scope: 'local' }

const fake: ResourceDockerService = {
  listContainers: async () => [container],
  listImages: async () => [image],
  listVolumes: async () => [volume],
  listNetworks: async () => [network],
  containerLogs: async (id, tail): Promise<ContainerLogs> => ({
    id,
    lines: `log line (tail ${tail})`,
  }),
  containerStats: async (id): Promise<ContainerStats> => ({
    id,
    cpuPct: 1.5,
    memPct: 2.25,
    memUsage: '12MiB / 2GiB',
    netIO: '1kB / 0B',
    blockIO: '0B / 0B',
    netRxBytes: 1_000,
    netTxBytes: 0,
    blockReadBytes: 0,
    blockWriteBytes: 0,
    pids: 7,
  }),
  containerTop: async (): Promise<ContainerTop> => ({
    headers: ['PID', 'CMD'],
    processes: [['1', 'postgres']],
  }),
}

const provider = createDockerResourceProvider(fake)

describe('docker resource provider', () => {
  test('roots = category folders', async () => {
    const roots = await provider.listChildren('u', null)
    expect(roots.map((r) => r.uri)).toEqual([
      'localix://resource/docker/containers',
      'localix://resource/docker/images',
      'localix://resource/docker/volumes',
      'localix://resource/docker/networks',
    ])
    expect(roots.every((r) => r.hasChildren)).toBe(true)
  })

  test('containers category → container folders', async () => {
    const kids = await provider.listChildren('u', 'localix://resource/docker/containers')
    expect(kids).toHaveLength(1)
    expect(kids[0]).toMatchObject({
      uri: 'localix://resource/docker/abc123def456',
      label: 'pg',
      hasChildren: true,
      icon: 'container',
    })
  })

  test('images/volumes/networks categories → entity leaves', async () => {
    expect(await provider.listChildren('u', 'localix://resource/docker/images')).toEqual([
      {
        uri: 'localix://resource/docker/image/sha256img01',
        label: 'postgres:16',
        detail: '142MB',
        hasChildren: false,
        icon: 'image',
      },
    ])
    expect(await provider.listChildren('u', 'localix://resource/docker/volumes')).toEqual([
      {
        uri: 'localix://resource/docker/volume/pgdata',
        label: 'pgdata',
        detail: 'local',
        hasChildren: false,
        icon: 'volume',
      },
    ])
    expect(await provider.listChildren('u', 'localix://resource/docker/networks')).toEqual([
      {
        uri: 'localix://resource/docker/network/netid01',
        label: 'app-net',
        detail: 'bridge · local',
        hasChildren: false,
        icon: 'network',
      },
    ])
  })

  test('container children = logs/stats/processes (running)', async () => {
    const kids = await provider.listChildren('u', 'localix://resource/docker/abc123def456')
    expect(kids.map((k) => k.uri)).toEqual([
      'localix://resource/docker/abc123def456/logs',
      'localix://resource/docker/abc123def456/stats',
      'localix://resource/docker/abc123def456/processes',
    ])
  })

  test('entity leaves have no children', async () => {
    expect(await provider.listChildren('u', 'localix://resource/docker/image/sha256img01')).toEqual(
      [],
    )
  })

  test('expand logs by short-id prefix returns tail', async () => {
    const res = await provider.expand('u', 'localix://resource/docker/abc123/logs')
    expect(res.ok).toBe(true)
    expect(res.content).toContain('log line (tail 400)')
  })

  test('expand container summary; unknown → error', async () => {
    expect(
      (await provider.expand('u', 'localix://resource/docker/abc123def456')).content,
    ).toContain('postgres:16')
    expect((await provider.expand('u', 'localix://resource/docker/nope')).ok).toBe(false)
  })

  test('expand image/volume/network entity refs', async () => {
    const img = await provider.expand('u', 'localix://resource/docker/image/sha256img01')
    expect(img.ok).toBe(true)
    expect(img.content).toContain('postgres:16')
    expect(img.content).toContain('142MB')

    const vol = await provider.expand('u', 'localix://resource/docker/volume/pgdata')
    expect(vol.ok).toBe(true)
    expect(vol.content).toContain('pgdata')

    const net = await provider.expand('u', 'localix://resource/docker/network/netid01')
    expect(net.ok).toBe(true)
    expect(net.content).toContain('app-net')

    expect((await provider.expand('u', 'localix://resource/docker/image/nope')).ok).toBe(false)
  })

  test('expand a category → listing summary', async () => {
    const res = await provider.expand('u', 'localix://resource/docker/images')
    expect(res.ok).toBe(true)
    expect(res.content).toContain('postgres:16')
  })

  test('a dead daemon is a classified notice, never an empty folder or "not found"', async () => {
    // The exact text Docker Desktop answers with when the socket is gone.
    const raw =
      'Cannot connect to the Docker daemon at unix:///Users/me/.docker/run/docker.sock: dial unix: connect: no such file or directory'
    const down = createDockerResourceProvider({
      ...fake,
      listContainers: async () => {
        throw new Error(raw)
      },
    })

    const nodes = await down.listChildren('u', 'localix://resource/docker/containers')
    expect(nodes).toEqual([
      {
        uri: 'localix://resource/docker/containers#notice',
        label: 'Docker is not available — is Docker installed and the daemon running?',
        detail: raw,
        hasChildren: false,
        notice: true,
      },
    ])

    const res = await down.expand('u', 'localix://resource/docker/abc123def456')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Docker is not available — is Docker installed and the daemon running?')
  })
})
