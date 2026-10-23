import { describe, expect, test } from 'bun:test'

import { createDockerContextProvider } from './context-provider'
import type { ResourceDockerService } from './resource-provider'
import type { ContextResolver } from '@localixai/mini-app-sdk/backend'

const service: ResourceDockerService = {
  listContainers: async () => [
    {
      id: 'abc123def456',
      name: 'pg',
      image: 'postgres:16',
      state: 'running',
      status: 'Up 3 hours',
      ports: '5432/tcp',
      createdAt: '2026-07-12',
    },
  ],
  listImages: async () => [],
  listVolumes: async () => [],
  listNetworks: async () => [],
  containerLogs: async () => ({ id: 'abc123def456', lines: 'started safely' }),
  containerStats: async () => null,
  containerTop: async () => ({ headers: [], processes: [] }),
}

const reference = {
  version: 1 as const,
  id: 'selected',
  kind: 'resource',
  uri: 'localix://resource/docker/abc123def456',
  freshness: 'resolve-at-send' as const,
  presentation: { label: 'pg' },
  scope: { userId: 'u', sessionId: 's' },
}

describe('docker Context Fabric provider', () => {
  test('owns only docker resources and produces revisioned explicit context for chat', async () => {
    const contribution = createDockerContextProvider(service)
    const provider = contribution.provider as ContextResolver
    expect(contribution.destinations).toEqual(['edit-prediction', 'inline-completion', 'chat'])
    expect(provider.supports(reference, 'chat')).toBe(true)
    expect(provider.supports({ ...reference, uri: 'localix://resource/db/c/table' }, 'chat')).toBe(
      false,
    )
    const result = await provider.resolve(
      reference,
      { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 10_000 },
      new AbortController().signal,
    )
    expect(result).toEqual([
      expect.objectContaining({
        providerId: 'devops:docker-context',
        uri: 'localix://resource/docker/abc123def456',
        sensitivity: 'project',
      }),
    ])
    expect(result[0]?.content).toContain('postgres:16')
    expect(result[0]?.revision).toMatch(/^docker-content:/)
  })

  test('does not read after cancellation', async () => {
    const provider = createDockerContextProvider(service).provider as ContextResolver
    const controller = new AbortController()
    controller.abort()
    expect(
      await provider.resolve(
        reference,
        { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 10_000 },
        controller.signal,
      ),
    ).toEqual([])
  })
})
