import { describe, expect, test } from 'bun:test'
import { createKubernetesSearchProvider, type KubernetesSearchPort } from './search-provider'

/**
 * Four ways to come back empty, one of which means "no pod matched". These pin that the
 * other three say so — and that a namespace nobody may read does not erase the
 * namespaces that answered.
 */
const port = (over: Partial<KubernetesSearchPort> = {}): KubernetesSearchPort => ({
  listContexts: async () => ({ current: 'kind', contexts: [{ name: 'kind' }] }),
  listNamespaces: async () => [{ name: 'default' }],
  listPods: async () => [],
  ...over,
})

const search = (p: KubernetesSearchPort) =>
  createKubernetesSearchProvider(p).search('u', { text: 'api' }) as Promise<{
    hits: unknown[]
    problem?: { message: string; detail?: string; field?: string }
  }>

describe('kubernetes search provider', () => {
  test('a reachable cluster with no match reports nothing', async () => {
    const out = await search(port())
    expect(out.hits).toEqual([])
    expect(out.problem).toBeUndefined()
  })

  test('no configured context says so instead of answering "no pods"', async () => {
    const out = await search(port({ listContexts: async () => ({ current: '', contexts: [] }) }))
    expect(out.problem?.field).toBe('no_kubeconfig')
    // Nothing more specific was ever known, so there is no raw text to keep.
    expect(out.problem?.detail).toBeUndefined()
  })

  test('an unreadable namespace list is classified from the client error', async () => {
    const out = await search(
      port({
        listNamespaces: async () => {
          throw Object.assign(new Error('forbidden'), {
            statusCode: 403,
            body: { message: 'namespaces is forbidden' },
          })
        },
      }),
    )
    expect(out.problem?.field).toBe('permission_denied')
    expect(out.problem?.detail).toBe('namespaces is forbidden')
  })

  test('one unreadable namespace keeps the pods the others returned', async () => {
    const out = await search(
      port({
        listNamespaces: async () => [{ name: 'a' }, { name: 'b' }],
        listPods: async (ns) => {
          if (ns === 'b') throw new Error('the server could not find the requested resource')
          return [{ name: 'api-1', namespace: 'a' }]
        },
      }),
    )
    expect(out.hits).toHaveLength(1)
    expect(out.problem).toBeDefined()
  })
})
