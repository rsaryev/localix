import { describe, expect, test } from 'bun:test'

import { createKubernetesContextProvider } from './context-provider'
import type { ResourceKubernetesService } from './resource-provider'
import type { ContextResolver } from '@localixai/mini-app-sdk/backend'

const service: ResourceKubernetesService = {
  listContexts: async () => ({ contexts: [], current: '' }),
  listNamespaces: async () => [],
  listPods: async () => [],
  getPod: async () => null,
  listDeployments: async () => [],
  listServices: async () => [],
  listNodes: async () => [],
  podLogs: async (_namespace, pod) => ({ pod, lines: 'panic-free log tail' }),
  describePod: async (_namespace, pod) => ({ pod, text: `Name: ${pod}` }),
  podEvents: async () => [],
  describeResource: async (kind, _namespace, name) => ({ kind, name, text: `${kind} ${name}` }),
  resourceEvents: async () => [],
  describeNode: async (name) => ({ pod: name, text: `Node: ${name}` }),
  getManifest: async (kind, name, namespace) => ({
    kind,
    name,
    namespace: namespace ?? '',
    yaml: `kind: ${kind}\nname: ${name}`,
  }),
}

const reference = {
  version: 1 as const,
  id: 'selected',
  kind: 'resource',
  uri: 'localix://resource/k8s/prod/apps/web-1/logs',
  freshness: 'resolve-at-send' as const,
  presentation: { label: 'web-1 logs' },
  scope: { userId: 'u', sessionId: 's' },
}

describe('Kubernetes Context Fabric provider', () => {
  test('captures an explicit k8s resource with a content revision', async () => {
    const contribution = createKubernetesContextProvider(service)
    const provider = contribution.provider as ContextResolver
    expect(contribution.destinations).toEqual(['edit-prediction', 'inline-completion', 'chat'])
    expect(provider.supports(reference, 'chat')).toBe(true)
    expect(
      provider.supports({ ...reference, uri: 'localix://resource/docker/container' }, 'chat'),
    ).toBe(false)
    const result = await provider.resolve(
      reference,
      { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 10_000 },
      new AbortController().signal,
    )
    expect(result).toEqual([
      expect.objectContaining({
        providerId: 'devops:kubernetes-context',
        uri: reference.uri,
        sensitivity: 'project',
      }),
    ])
    expect(result[0]?.content).toContain('panic-free log tail')
    expect(result[0]?.revision).toMatch(/^k8s-content:/)
  })
})
