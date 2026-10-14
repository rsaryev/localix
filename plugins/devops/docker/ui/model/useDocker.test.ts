import { describe, expect, test } from 'bun:test'
import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from '../../backend/contracts'
import { DockerApiError } from '../dockerApi'
import {
  DOCKER_RECOVERY_POLL_MS,
  DOCKER_SECONDARY_POLL_MS,
  dockerInventoryPollScope,
  mergeDockerInventory,
} from './useDocker'
import { dockerEventScope, dockerPollIntervalMs } from './dockerInventory'

const container: DockerContainer = {
  id: 'container-1',
  name: 'api',
  image: 'api:latest',
  state: 'running',
  status: 'Up',
  ports: '',
  createdAt: 'now',
}
const image: DockerImage = {
  id: 'image-1',
  repository: 'api',
  tag: 'latest',
  size: '10MB',
  createdAt: 'now',
}
const volume: DockerVolume = { name: 'data', driver: 'local', scope: 'local' }
const network: DockerNetwork = { id: 'network-1', name: 'app', driver: 'bridge', scope: 'local' }
const previous = {
  containers: [container],
  images: [image],
  volumes: [volume],
  networks: [network],
}

describe('Docker inventory reconciliation', () => {
  test('an unchanged poll keeps the on-screen arrays, so no row re-renders', () => {
    const merged = mergeDockerInventory(previous, [
      { status: 'fulfilled', value: [{ ...container }] },
      { status: 'fulfilled', value: [{ ...image }] },
      { status: 'fulfilled', value: [{ ...volume }] },
      { status: 'fulfilled', value: [{ ...network }] },
    ])

    expect(merged.snapshot.containers).toBe(previous.containers)
    expect(merged.snapshot.images).toBe(previous.images)
    expect(merged.snapshot.volumes).toBe(previous.volumes)
    expect(merged.snapshot.networks).toBe(previous.networks)
  })

  test('a changed row keeps its unchanged siblings identical', () => {
    const second: DockerContainer = { ...container, id: 'container-2', name: 'other' }
    const before = { ...previous, containers: [container, second] }
    const merged = mergeDockerInventory(before, [
      { status: 'fulfilled', value: [{ ...container }, { ...second, state: 'exited' }] },
      { status: 'fulfilled', value: [image] },
      { status: 'fulfilled', value: [volume] },
      { status: 'fulfilled', value: [network] },
    ])

    expect(merged.snapshot.containers).not.toBe(before.containers)
    expect(merged.snapshot.containers[0]).toBe(container)
    expect(merged.snapshot.containers[1]?.state).toBe('exited')
  })

  test('updates successful collections and preserves the last good failed collection', () => {
    const nextImage = { ...image, tag: 'next' }
    const merged = mergeDockerInventory(previous, [
      { status: 'fulfilled', value: [] },
      { status: 'fulfilled', value: [nextImage] },
      { status: 'rejected', reason: new Error('volume access denied') },
      { status: 'fulfilled', value: [] },
    ])

    expect(merged.snapshot).toEqual({
      containers: [],
      images: [nextImage],
      volumes: [volume],
      networks: [],
    })
    expect(merged.resourceErrors).toEqual({ volumes: { message: 'volume access denied' } })
    expect(merged.error).toBeNull()
    expect(merged.unavailable).toBe(false)
  })

  // An absent engine used to be nulled here and drawn as a separate notice that offered only Retry
  // and never reached the Event Center. It is the pane's failure, carrying its way out.
  test('a fully unavailable engine is the root error, carrying its prerequisite', () => {
    const prerequisite = { id: 'docker', name: 'Docker', state: 'stopped' as const }
    const failure = () => ({
      status: 'rejected' as const,
      reason: new DockerApiError('Engine unavailable', 'engine_unavailable', undefined, {
        prerequisite,
      }),
    })
    const merged = mergeDockerInventory(previous, [failure(), failure(), failure(), failure()])

    expect(merged.snapshot).toEqual(previous)
    expect(merged.unavailable).toBe(true)
    expect(merged.error?.prerequisite).toEqual(prerequisite)
  })

  test('surfaces a root error only when every independent read fails', () => {
    const failure = () => ({ status: 'rejected' as const, reason: new Error('transport down') })
    const merged = mergeDockerInventory(previous, [failure(), failure(), failure(), failure()])

    expect(merged.unavailable).toBe(false)
    expect(merged.error).toEqual({ message: 'transport down' })
  })
})

describe('Docker inventory polling cadence', () => {
  test('loads every collection first, then keeps fast ticks container-only', () => {
    const startedAt = 10_000
    expect(dockerInventoryPollScope(0, startedAt)).toBe('all')
    expect(dockerInventoryPollScope(startedAt, startedAt + 4_000)).toBe('containers')
    expect(dockerInventoryPollScope(startedAt, startedAt + DOCKER_SECONDARY_POLL_MS - 1)).toBe(
      'containers',
    )
    expect(dockerInventoryPollScope(startedAt, startedAt + DOCKER_SECONDARY_POLL_MS)).toBe('all')
  })

  test('retries stale secondary collections sooner without hammering every fast tick', () => {
    const startedAt = 10_000
    const errors = { volumes: { message: 'volume access denied' } }

    expect(dockerInventoryPollScope(startedAt, startedAt + 4_000, errors)).toBe('containers')
    expect(
      dockerInventoryPollScope(startedAt, startedAt + DOCKER_RECOVERY_POLL_MS - 1, errors),
    ).toBe('containers')
    expect(dockerInventoryPollScope(startedAt, startedAt + DOCKER_RECOVERY_POLL_MS, errors)).toBe(
      'all',
    )
  })
})

describe('Docker inventory while the events stream is live', () => {
  test('the four-second poll stops, and falls back the moment it is down', () => {
    expect(dockerPollIntervalMs(false, 4_000)).toBe(4_000)
    expect(dockerPollIntervalMs(true, 4_000)).toBeNull()
  })

  test('an explicit refresh while live reads everything', () => {
    expect(dockerInventoryPollScope(10_000, 14_000, {}, true)).toBe('all')
  })

  test('a container event re-reads containers; any other kind re-reads everything', () => {
    expect(dockerEventScope('container')).toBe('containers')
    expect(dockerEventScope('image')).toBe('all')
    expect(dockerEventScope('volume')).toBe('all')
    expect(dockerEventScope('network')).toBe('all')
  })
})
