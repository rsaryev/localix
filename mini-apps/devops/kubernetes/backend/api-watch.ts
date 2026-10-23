import type * as k8s from '@kubernetes/client-node'
import { ALL_NAMESPACES, type KubeWatchFrame, type KubeWatchStatus } from './contracts'
import { createKubeConfig } from './api-internals'
import { createBunApiClient, getBunKubernetesClasses } from './api-http'
import { getKubernetesClient } from './kubernetes-client'
import { parsePodItem } from './parse-pods'

export interface WatchSubscriber {
  onFrame(frame: KubeWatchFrame): void
}

interface Entry {
  context: string
  namespace: string
  subscribers: Set<WatchSubscriber>
  informer: k8s.Informer<k8s.V1Pod> | null
  status: KubeWatchStatus
  idleTimer: ReturnType<typeof setTimeout> | null
  restartTimer: ReturnType<typeof setTimeout> | null
  restartAttempt: number
  generation: number
  /**
   * Set from `start()` until its informer is assigned. `start` awaits the client, the kubeconfig
   * and the API before it has an informer, and a second subscriber in that window read
   * `informer === null` and started a second one, overwriting the first — which then ran forever.
   */
  starting: boolean
}

/** The pod informer for one entry — a seam so the start race is testable without a cluster. */
export type CreatePodInformer = (context: string, namespace: string) => Promise<PodInformer>
type PodInformer = k8s.Informer<k8s.V1Pod>

const clusterPodInformer: CreatePodInformer = async (context, namespace) => {
  const k8s = await getKubernetesClient()
  const config = await createKubeConfig(context || undefined)
  const core = await createBunApiClient(config, k8s.CoreV1Api)
  const all = namespace === ALL_NAMESPACES
  const path = all ? '/api/v1/pods' : `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`
  const { BunKubernetesWatch } = await getBunKubernetesClasses()
  return new k8s.ListWatch<k8s.V1Pod>(
    path,
    new BunKubernetesWatch(config),
    all ? () => core.listPodForAllNamespaces() : () => core.listNamespacedPod({ namespace }),
    false,
  )
}

const WATCH_RESTART_BASE_MS = 1_500
const WATCH_RESTART_MAX_MS = 30_000

/**
 * Capped exponential reconnect delay. A dead VPN/API server must not be hit every
 * 1.5 seconds forever; the REST poll remains the authoritative fallback while this
 * quiet background watch works its way back.
 */
export function watchRestartDelay(attempt: number): number {
  return Math.min(WATCH_RESTART_BASE_MS * 2 ** Math.max(0, attempt), WATCH_RESTART_MAX_MS)
}

/**
 * Ref-counted pod informers over the standard list/watch/cache flow. The official client
 * performs the initial list, resumes the watch from resourceVersion, and keeps its
 * object cache coherent; this class only fans changes out to websocket subscribers.
 */
export class ApiPodWatchRegistry {
  private readonly entries = new Map<string, Entry>()
  constructor(
    private readonly idleTtlMs = 5000,
    private readonly createInformer: CreatePodInformer = clusterPodInformer,
  ) {}

  private key(context: string, namespace: string): string {
    return `${context}\n${namespace}`
  }

  subscribe(context: string, namespace: string, subscriber: WatchSubscriber): () => void {
    const key = this.key(context, namespace)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        context,
        namespace,
        subscribers: new Set(),
        informer: null,
        status: 'down',
        idleTimer: null,
        restartTimer: null,
        restartAttempt: 0,
        generation: 0,
        starting: false,
      }
      this.entries.set(key, entry)
    }
    const wasIdle = entry.subscribers.size === 0
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = null
    entry.subscribers.add(subscriber)
    if (wasIdle) entry.restartAttempt = 0
    subscriber.onFrame({
      kind: 'status',
      context,
      namespace,
      status: entry.status,
    })
    if (!entry.informer && !entry.restartTimer && !entry.starting) void this.start(entry)
    return () => {
      entry!.subscribers.delete(subscriber)
      if (entry!.subscribers.size === 0) {
        entry!.idleTimer = setTimeout(() => void this.stop(key), this.idleTtlMs)
      }
    }
  }

  private broadcast(entry: Entry, frame: KubeWatchFrame): void {
    for (const subscriber of entry.subscribers) subscriber.onFrame(frame)
  }

  private setStatus(entry: Entry, status: KubeWatchStatus): void {
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

  private async start(entry: Entry): Promise<void> {
    const generation = ++entry.generation
    entry.starting = true
    try {
      let informer: PodInformer
      try {
        informer = await this.createInformer(entry.context, entry.namespace)
      } finally {
        entry.starting = false
      }
      // `stop()` (the idle timeout on a slow cluster) may have run during that await: the entry
      // is gone and nothing would ever stop an informer parked on it now.
      if (entry.generation !== generation) return
      entry.informer = informer
      const emit = (action: 'ADDED' | 'MODIFIED' | 'DELETED') => (pod: k8s.V1Pod) => {
        if (entry.generation !== generation || !pod.metadata?.name) return
        this.setStatus(entry, 'live')
        this.broadcast(entry, {
          kind: 'pod',
          context: entry.context,
          namespace: entry.namespace,
          action,
          pod: parsePodItem(pod as unknown as Record<string, unknown>),
        })
      }
      informer.on('add', emit('ADDED'))
      informer.on('update', emit('MODIFIED'))
      informer.on('delete', emit('DELETED'))
      informer.on('error', () => void this.failed(entry, generation))
      await informer.start()
      // BunKubernetesWatch reports an HTTP failure through the informer callback
      // before `start()` resolves. Do not overwrite that failure with a stale `live`
      // frame or reset the exponential backoff to its first step.
      if (entry.generation === generation && entry.informer === informer) {
        this.setStatus(entry, 'live')
      }
    } catch {
      // The watch is a live-refresh nicety over an authoritative REST poll; its whole report is
      // the `down` status frame the UI already renders, and it retries on its own.
      await this.failed(entry, generation)
    }
  }

  private async failed(entry: Entry, generation: number): Promise<void> {
    if (entry.generation !== generation) return
    const informer = entry.informer
    entry.informer = null
    if (informer) await informer.stop().catch(() => undefined)
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
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    if (entry.restartTimer) clearTimeout(entry.restartTimer)
    if (entry.informer) await entry.informer.stop().catch(() => undefined)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((key) => this.stop(key)))
  }
}
