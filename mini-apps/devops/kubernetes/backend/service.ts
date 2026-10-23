import type { KubernetesBackend } from './backend-port'
import { createKubernetesApiBackend } from './api-backend'
import { ApiPodWatchRegistry, type WatchSubscriber } from './api-watch'
import { ApiCollectionWatchRegistry, type CollectionWatchSubscriber } from './api-collection-watch'
import { ApiPortForwardRegistry, type StartPortForwardOptions } from './api-port-forward'
import { ApiExecRegistry } from './api-exec'
import type { PortForward } from './contracts'

/**
 * Kubernetes workbench service — a thin, stateless pass-through over the
 * {@link KubernetesBackend} port. No per-user registry and no persistence: the
 * kubeconfig on disk is the source of truth, and the active context is selected
 * per-request by the API client, so there is nothing to store.
 * Errors flow up as typed {@link KubeError} from the backend and are serialised by
 * the routes.
 *
 * EXTENDS the port rather than repeating it. It used to redeclare all 22 port methods
 * verbatim, which meant every port addition had to be written twice and a signature
 * could drift between the two without any gate noticing.
 */
export interface KubernetesService extends KubernetesBackend {
  /** Build a one-time terminal command backed by the Kubernetes pods/exec API. */
  startPodExec(
    namespace: string,
    pod: string,
    context?: string,
    container?: string,
  ): Promise<string>
  /** Start a managed Kubernetes API port-forward (in-memory; not persisted). */
  startPortForward(opts: StartPortForwardOptions): Promise<PortForward>
  /** Stop a managed forward by id after its listener and tunnels close. */
  stopPortForward(id: string): Promise<void>
  /** Stop every forward tagged with `owner` after its transient surface closes. */
  stopPortForwardsByOwner(owner: string): Promise<number>
  /** List the currently-active managed forwards. */
  listPortForwards(): PortForward[]
  /** Hear every change of {@link listPortForwards}; returns the release. */
  watchPortForwards(listener: () => void): () => void
  /** Stop every managed forward during shutdown. */
  stopAllPortForwards(): Promise<void>
  /**
   * Subscribe to a live informer for a (context, namespace). Its add/modify/delete
   * and liveness frames are fanned out to reference-counted subscribers.
   */
  watchPods(context: string, namespace: string, sub: WatchSubscriber): () => void
  /** The same for deployments, services and nodes: `changed` frames name what to re-read. */
  watchCollections(context: string, namespace: string, sub: CollectionWatchSubscriber): () => void
  /** Stop every live informer during shutdown. */
  stopAllWatches(): Promise<void>
  /** Close every pending/live pods/exec bridge. */
  stopAllExecs(): Promise<void>
}

export interface KubernetesServiceOptions {
  /** Injectable backend for tests; runtime defaults to the Kubernetes API. */
  backend?: KubernetesBackend
}

export function createKubernetesService(options: KubernetesServiceOptions = {}): KubernetesService {
  const backend = options.backend ?? createKubernetesApiBackend()
  const portForwards = new ApiPortForwardRegistry()
  const watches = new ApiPodWatchRegistry()
  const collections = new ApiCollectionWatchRegistry()
  const execs = new ApiExecRegistry()
  return {
    // The read/act surface is the backend port verbatim (KubernetesService repeats it
    // method-for-method); only the two stateful registries add service-owned methods.
    // NOTE: a backend impl must carry its methods as OWN enumerable properties (an
    // object literal, like the bundled API implementation and test fakes) — a spread
    // does not copy class-prototype methods.
    ...backend,
    startPodExec: (namespace, pod, context, container) =>
      execs.command({ namespace, pod, context, container }),
    startPortForward: (opts) => portForwards.start(opts),
    stopPortForward: (id) => portForwards.stop(id),
    stopPortForwardsByOwner: (owner) => portForwards.stopByOwner(owner),
    listPortForwards: () => portForwards.list(),
    watchPortForwards: (listener) => portForwards.onChange(listener),
    stopAllPortForwards: () => portForwards.stopAll(),
    watchPods: (context, namespace, sub) => watches.subscribe(context, namespace, sub),
    watchCollections: (context, namespace, sub) => collections.subscribe(context, namespace, sub),
    stopAllWatches: async () => {
      await Promise.all([watches.stopAll(), collections.stopAll()])
    },
    stopAllExecs: () => execs.stopAll(),
  }
}
