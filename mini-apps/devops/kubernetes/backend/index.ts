/**
 * Kubernetes provider backend inside the bundled DevOps Workspace mini app.
 *
 * `register()` constructs the Kubernetes API service and contributes it as a `BackendSubsystem`: the
 * boot-time loader (`loadMiniAppBackends`) mounts the route (`/rpc/kubernetes`),
 * registers the resource (`localix://resource/k8s`) + global-search providers, wires the live
 * pod-watch, the deployment/service/node changes, the port-forward changes and the followed pod
 * logs (`logs-follow.ts`) as generic WS-frame streams, and calls `onShutdown` on shutdown.
 * It contributes NO agent tool; see the reasoning at the `register()` body below.
 *
 * It owns API informer, port-forward, and exec websocket lifecycles and closes them
 * from `onShutdown`.
 *
 * The pod-watch (previously a hardcoded `devops:k8s.watch.subscribe`/`unsubscribe` path in
 * `realtime/ws.ts`) is now expressed as a `WsFrameContribution`: a subscribe command
 * acquires a per-(context,namespace) informer whose frames are pushed as `w\n<json>`
 * frames; an unsubscribe (or socket close) releases it. Core consults the generic
 * `WsFrameRegistry` for these otherwise-unrecognized commands — no k8s literal in core.
 */
import { createKubernetesService, type KubernetesService } from './service'
import { createKubernetesRoutes } from './routes'
import { createKubernetesResourceProvider } from './resource-provider'
import { createKubernetesSearchProvider } from './search-provider'
import { createKubernetesContextProvider } from './context-provider'
import {
  PORT_FORWARDS_FRAME_TAG,
  PORT_FORWARDS_SUBSCRIBE,
  PORT_FORWARDS_UNSUBSCRIBE,
  type PortForwardsFrame,
} from './forwards-contract'
import {
  COLLECTIONS_FRAME_TAG,
  COLLECTIONS_SUBSCRIBE,
  COLLECTIONS_UNSUBSCRIBE,
} from './collections-contract'
import { createKubeLogsHub, createKubeLogsWsFrame } from './logs-follow'
import type { MiniAppRegistration, WsFrameContribution } from '@localixai/mini-app-sdk/backend'

/**
 * The forward registry's changes as a stream. Forwards are host-wide (every tab reads the one
 * list and filters by owner), so every socket shares one key.
 */
export function createPortForwardsWsFrame(
  service: Pick<KubernetesService, 'watchPortForwards'>,
): WsFrameContribution {
  const changed: PortForwardsFrame = { kind: 'changed' }
  return {
    subscribeCommand: PORT_FORWARDS_SUBSCRIBE,
    unsubscribeCommand: PORT_FORWARDS_UNSUBSCRIBE,
    frameTag: PORT_FORWARDS_FRAME_TAG,
    key: () => 'forwards',
    start: (_params, send) => service.watchPortForwards(() => send(JSON.stringify(changed))),
    stop: (handle) => {
      if (typeof handle === 'function') (handle as () => void)()
    },
  }
}

/** Deployment, service and node changes for one (context, namespace), as `o` frames. */
export function createCollectionsWsFrame(
  service: Pick<KubernetesService, 'watchCollections'>,
): WsFrameContribution {
  return {
    subscribeCommand: COLLECTIONS_SUBSCRIBE,
    unsubscribeCommand: COLLECTIONS_UNSUBSCRIBE,
    frameTag: COLLECTIONS_FRAME_TAG,
    key: (params) =>
      `${(params.context as string | undefined) ?? ''}\n${(params.namespace as string | undefined) ?? ''}`,
    start: (params, send) => {
      const context = typeof params.context === 'string' ? params.context : ''
      const namespace = typeof params.namespace === 'string' ? params.namespace : ''
      return service.watchCollections(context, namespace, {
        onFrame: (frame) => send(JSON.stringify(frame)),
      })
    },
    stop: (handle) => {
      if (typeof handle === 'function') (handle as () => void)()
    },
  }
}

export async function register(): Promise<MiniAppRegistration> {
  const service = createKubernetesService()
  const logs = createKubeLogsHub()

  // NO agent tools. `kubernetes_get` and `kubernetes_manage` cost ~930 tokens of schema on
  // every request to wrap verbs of a CLI the agent already drives through `bash`. The
  // confirmation `kubernetes_manage` raised itself is not lost: `kubectl delete` and
  // `kubectl drain` are now in bash's DANGEROUS_PATTERNS, so the `bash + dangerous` rule
  // asks in every mode but yolo — the same prompt, one layer down. The workbench panel,
  // the routes, the resource/search/context providers and the live pod watch all stay.
  // Live pod watch as a generic WS-frame stream (the de-hardcoded form of the old
  // core `devops:k8s.watch.subscribe`/`unsubscribe` path). `params` is the raw command
  // envelope `{ t, context?, namespace }`; the frame tag `w` preserves the wire.
  const podWatch: WsFrameContribution = {
    subscribeCommand: 'devops:k8s.watch.subscribe',
    unsubscribeCommand: 'devops:k8s.watch.unsubscribe',
    frameTag: 'w',
    key: (params) =>
      `${(params.context as string | undefined) ?? ''}\n${(params.namespace as string | undefined) ?? ''}`,
    start: (params, send) => {
      const context = typeof params.context === 'string' ? params.context : ''
      const namespace = typeof params.namespace === 'string' ? params.namespace : ''
      return service.watchPods(context, namespace, {
        onFrame: (frame) => send(JSON.stringify(frame)),
      })
    },
    stop: (handle) => {
      if (typeof handle === 'function') (handle as () => void)()
    },
  }

  return {
    backend: [
      {
        id: 'devops:kubernetes',
        routeMount: { path: '/rpc/kubernetes', app: createKubernetesRoutes(service) },
        resourceProvider: createKubernetesResourceProvider(service),
        contextProviders: [createKubernetesContextProvider(service)],
        searchProvider: createKubernetesSearchProvider({
          listContexts: () => service.listContexts(),
          listNamespaces: (context) => service.listNamespaces(context),
          listPods: (namespace, context) => service.listPods(namespace, context),
        }),
        wsFrames: [
          podWatch,
          createPortForwardsWsFrame(service),
          createCollectionsWsFrame(service),
          createKubeLogsWsFrame(logs),
        ],
        onShutdown: async () => {
          logs.stopAll()
          await service.stopAllExecs()
          await service.stopAllPortForwards()
          await service.stopAllWatches()
        },
      },
    ],
    tools: [],
  }
}
