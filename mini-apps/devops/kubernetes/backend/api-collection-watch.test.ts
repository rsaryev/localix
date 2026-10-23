import { describe, expect, test } from 'bun:test'
import { createWsFrameConnection, createWsFrameRegistry } from '@localixai/mini-app-sdk/backend'

import {
  ApiCollectionWatchRegistry,
  type CollectionInformer,
  type CreateCollectionInformer,
} from './api-collection-watch'
import type { KubeCollectionsFrame, WatchedCollection } from './collections-contract'
import { createCollectionsWsFrame } from './index'

type Event = 'add' | 'update' | 'delete' | 'error'

/** Informers driven by hand: the test says what the cluster did. */
function fakeInformers(fail: Partial<Record<WatchedCollection, unknown>> = {}) {
  const made = new Map<
    WatchedCollection,
    { emit: (e: Event, v?: unknown) => void; stops: number }
  >()
  const create: CreateCollectionInformer = async (_context, _namespace, collection) => {
    const handlers = new Map<Event, Array<(value: unknown) => void>>()
    const record = {
      stops: 0,
      emit: (event: Event, value?: unknown) => {
        for (const handler of handlers.get(event) ?? []) handler(value)
      },
    }
    made.set(collection, record)
    const informer: CollectionInformer = {
      on: (event, callback) => void handlers.set(event, [...(handlers.get(event) ?? []), callback]),
      start: async () => {
        if (collection in fail) record.emit('error', fail[collection])
      },
      stop: async () => void record.stops++,
    }
    return informer
  }
  return { create, made }
}

/** Let the registry's awaited starts and zero-delay flushes run. */
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

function follow(registry: ApiCollectionWatchRegistry) {
  const frames: KubeCollectionsFrame[] = []
  const release = registry.subscribe('ctx', 'default', { onFrame: (f) => frames.push(f) })
  return { frames, release }
}

describe('Kubernetes collection watch', () => {
  test('goes live once every informer runs, and a burst of changes is one frame', async () => {
    const { create, made } = fakeInformers()
    const registry = new ApiCollectionWatchRegistry({ createInformer: create, flushMs: 0 })
    const { frames } = follow(registry)
    await turn()
    expect(frames.map((f) => (f.kind === 'status' ? f.status : f.kind))).toEqual(['down', 'live'])

    made.get('deployments')!.emit('update', {})
    made.get('deployments')!.emit('update', {})
    made.get('services')!.emit('add', {})
    await turn()
    expect(frames.at(-1)).toEqual({
      kind: 'changed',
      context: 'ctx',
      namespace: 'default',
      collections: ['deployments', 'services'],
    })
    expect(frames.filter((f) => f.kind === 'changed')).toHaveLength(1)
    await registry.stopAll()
  })

  test('a collection this identity may not list is let go; the rest stay live', async () => {
    const { create, made } = fakeInformers({ nodes: { statusCode: 403 } })
    const registry = new ApiCollectionWatchRegistry({ createInformer: create, flushMs: 0 })
    const { frames } = follow(registry)
    await turn()
    expect(frames.at(-1)).toMatchObject({ kind: 'status', status: 'live' })
    expect(made.get('nodes')!.stops).toBe(1)
    expect(made.get('deployments')!.stops).toBe(0)
    await registry.stopAll()
  })

  test('a failed watch reports down, and stops every informer it started', async () => {
    const { create, made } = fakeInformers()
    const registry = new ApiCollectionWatchRegistry({ createInformer: create, flushMs: 0 })
    const { frames } = follow(registry)
    await turn()
    made.get('services')!.emit('error', new Error('connection reset'))
    await turn()
    expect(frames.at(-1)).toMatchObject({ kind: 'status', status: 'down' })
    expect([...made.values()].map((informer) => informer.stops)).toEqual([1, 1, 1])
    // A late change from the dead watch says nothing.
    made.get('deployments')!.emit('update', {})
    await turn()
    expect(frames.some((f) => f.kind === 'changed')).toBe(false)
    await registry.stopAll() // clears the armed restart
  })

  test('streams as `o` frames through the WS frame registry', async () => {
    const { create, made } = fakeInformers()
    const registry = new ApiCollectionWatchRegistry({ createInformer: create, flushMs: 0 })
    const frames = createWsFrameRegistry()
    expect(
      frames.register(
        createCollectionsWsFrame({
          watchCollections: (context, namespace, sub) =>
            registry.subscribe(context, namespace, sub),
        }),
      ),
    ).toEqual({ status: 'registered' })
    const sent: string[] = []
    const connection = createWsFrameConnection(frames, (data) => sent.push(data), { userId: 'u' })
    connection.subscribe('devops:k8s.collections.subscribe', { namespace: 'default' })
    await turn()
    made.get('nodes')!.emit('delete', {})
    await turn()
    expect(sent.at(-1)).toBe(
      `o\n${JSON.stringify({ kind: 'changed', context: '', namespace: 'default', collections: ['nodes'] })}`,
    )
    connection.teardown()
    await registry.stopAll()
  })
})
