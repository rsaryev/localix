import type * as k8s from '@kubernetes/client-node'
import { createKubeConfig } from './api-internals'
import { createBunApiClient, getBunKubernetesClasses } from './api-http'
import { watchRestartDelay } from './api-watch'
import {
  WATCHED_COLLECTIONS,
  type KubeCollectionsFrame,
  type WatchedCollection,
} from './collections-contract'
import { ALL_NAMESPACES } from './contracts'
import { getKubernetesClient } from './kubernetes-client'

export interface CollectionWatchSubscriber {
  onFrame(frame: KubeCollectionsFrame): void
}

/** The slice of an informer this registry drives — a seam so tests need no cluster. */
export interface CollectionInformer {
  on(event: 'add' | 'update' | 'delete' | 'error', callback: (value: unknown) => void): void
  start(): Promise<void>
  stop(): Promise<void>
}

export type CreateCollectionInformer = (
  context: string,
  namespace: string,
  collection: WatchedCollection,
) => Promise<CollectionInformer>

const clusterCollectionInformer: CreateCollectionInformer = async (
  context,
  namespace,
  collection,
) => {
  const k8s = await getKubernetesClient()
  const config = await createKubeConfig(context || undefined)
  const { BunKubernetesWatch } = await getBunKubernetesClasses()
  const watch = new BunKubernetesWatch(config)
  const all = namespace === ALL_NAMESPACES
  const scoped = encodeURIComponent(namespace)
  if (collection === 'deployments') {
    const apps = await createBunApiClient(config, k8s.AppsV1Api)
    return new k8s.ListWatch<k8s.V1Deployment>(
      all ? '/apis/apps/v1/deployments' : `/apis/apps/v1/namespaces/${scoped}/deployments`,
      watch,
      all
        ? () => apps.listDeploymentForAllNamespaces()
        : () => apps.listNamespacedDeployment({ namespace }),
      false,
    ) as unknown as CollectionInformer
  }
  const core = await createBunApiClient(config, k8s.CoreV1Api)
  if (collection === 'services') {
    return new k8s.ListWatch<k8s.V1Service>(
      all ? '/api/v1/services' : `/api/v1/namespaces/${scoped}/services`,
      watch,
      all
        ? () => core.listServiceForAllNamespaces()
        : () => core.listNamespacedService({ namespace }),
      false,
    ) as unknown as CollectionInformer
  }
  return new k8s.ListWatch<k8s.V1Node>(
    '/api/v1/nodes',
    watch,
    () => core.listNode(),
    false,
  ) as unknown as CollectionInformer
}

/**
 * A collection this identity may not list (403) or this cluster does not serve (404). The REST
 * read of it fails the same way, so there is nothing to keep fresh: its informer is let go and the
 * rest stay live, instead of restarting all three on a backoff forever.
 */
export function unreadableCollection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { statusCode, code } = error as { statusCode?: unknown; code?: unknown }
  const status = statusCode ?? code
  return status === 403 || status === 404
}

interface Entry {
  context: string
  namespace: string
  subscribers: Set<CollectionWatchSubscriber>
  informers: CollectionInformer[]
  status: 'live' | 'down'
  pending: Set<WatchedCollection>
  flushTimer: ReturnType<typeof setTimeout> | null
  idleTimer: ReturnType<typeof setTimeout> | null
  restartTimer: ReturnType<typeof setTimeout> | null
  restartAttempt: number
  generation: number
  starting: boolean
}

export interface CollectionWatchOptions {
  /** How long a watch nobody follows lingers, so a tab switch does not re-list the cluster. */
  idleTtlMs?: number
  /** A burst of changes (a rollout touches a deployment many times) becomes one frame. */
  flushMs?: number
  createInformer?: CreateCollectionInformer
}

/**
 * Ref-counted informers over deployments, services and nodes for one (context, namespace). Each
 * change marks its collection; a short window folds a burst into one `changed` frame. The status
 * is `live` only while every readable collection's informer runs: a reader polls otherwise.
 */
export class ApiCollectionWatchRegistry {
  private readonly entries = new Map<string, Entry>()
  private readonly idleTtlMs: number
  private readonly flushMs: number
  private readonly createInformer: CreateCollectionInformer

  constructor(options: CollectionWatchOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? 5000
    this.flushMs = options.flushMs ?? 250
    this.createInformer = options.createInformer ?? clusterCollectionInformer
  }

  subscribe(context: string, namespace: string, subscriber: CollectionWatchSubscriber): () => void {
    const key = `${context}\n${namespace}`
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        context,
        namespace,
        subscribers: new Set(),
        informers: [],
        status: 'down',
        pending: new Set(),
        flushTimer: null,
        idleTimer: null,
        restartTimer: null,
        restartAttempt: 0,
        generation: 0,
        starting: false,
      }
      this.entries.set(key, entry)
    }
    const current = entry
    if (current.idleTimer) clearTimeout(current.idleTimer)
    current.idleTimer = null
    if (current.subscribers.size === 0) current.restartAttempt = 0
    current.subscribers.add(subscriber)
    subscriber.onFrame({ kind: 'status', context, namespace, status: current.status })
    if (current.informers.length === 0 && !current.restartTimer && !current.starting) {
      void this.start(current)
    }
    return () => {
      current.subscribers.delete(subscriber)
      if (current.subscribers.size === 0 && this.entries.get(key) === current) {
        current.idleTimer = setTimeout(() => void this.stop(key), this.idleTtlMs)
      }
    }
  }

  private broadcast(entry: Entry, frame: KubeCollectionsFrame): void {
    for (const subscriber of entry.subscribers) subscriber.onFrame(frame)
  }

  private setStatus(entry: Entry, status: 'live' | 'down'): void {
    if (status === 'live') entry.restartAttempt = 0
    if (entry.status === status) return
    entry.status = status
    this.broadcast(entry, {
      kind: 'status',
      context: entry.context,
      namespace: entry.namespace,
      status,
    })
  }

  private mark(entry: Entry, collection: WatchedCollection): void {
    entry.pending.add(collection)
    entry.flushTimer ??= setTimeout(() => {
      entry.flushTimer = null
      const collections = WATCHED_COLLECTIONS.filter((name) => entry.pending.has(name))
      entry.pending.clear()
      if (collections.length === 0) return
      this.broadcast(entry, {
        kind: 'changed',
        context: entry.context,
        namespace: entry.namespace,
        collections,
      })
    }, this.flushMs)
  }

  private async start(entry: Entry): Promise<void> {
    const generation = ++entry.generation
    entry.starting = true
    try {
      let informers: CollectionInformer[]
      try {
        informers = await Promise.all(
          WATCHED_COLLECTIONS.map((name) =>
            this.createInformer(entry.context, entry.namespace, name),
          ),
        )
      } finally {
        entry.starting = false
      }
      // Stopped (idle) while the cluster answered: nothing would ever stop these informers.
      if (entry.generation !== generation) return
      entry.informers = informers
      informers.forEach((informer, index) => {
        const name = WATCHED_COLLECTIONS[index]!
        const changed = () => {
          if (entry.generation === generation) this.mark(entry, name)
        }
        informer.on('add', changed)
        informer.on('update', changed)
        informer.on('delete', changed)
        informer.on('error', (error) => {
          if (unreadableCollection(error)) void informer.stop().catch(() => undefined)
          else void this.failed(entry, generation)
        })
      })
      await Promise.all(
        informers.map((informer) =>
          informer.start().catch((error: unknown) => {
            if (!unreadableCollection(error)) throw error
            void informer.stop().catch(() => undefined)
          }),
        ),
      )
      // A failure reported through the error callback while starting already moved on.
      if (entry.generation === generation && entry.informers === informers) {
        this.setStatus(entry, 'live')
      }
    } catch {
      await this.failed(entry, generation)
    }
  }

  private async failed(entry: Entry, generation: number): Promise<void> {
    if (entry.generation !== generation) return
    entry.generation++
    const informers = entry.informers
    entry.informers = []
    await Promise.all(informers.map((informer) => informer.stop().catch(() => undefined)))
    this.setStatus(entry, 'down')
    if (entry.subscribers.size === 0 || entry.restartTimer) return
    const delay = watchRestartDelay(entry.restartAttempt)
    entry.restartAttempt++
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null
      if (entry.subscribers.size > 0) void this.start(entry)
    }, delay)
  }

  private async stop(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    entry.generation++
    for (const timer of [entry.idleTimer, entry.restartTimer, entry.flushTimer]) {
      if (timer) clearTimeout(timer)
    }
    const informers = entry.informers
    entry.informers = []
    await Promise.all(informers.map((informer) => informer.stop().catch(() => undefined)))
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((key) => this.stop(key)))
  }
}
