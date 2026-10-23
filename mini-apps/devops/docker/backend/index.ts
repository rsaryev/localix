/**
 * Docker provider backend inside the bundled DevOps Workspace mini app.
 *
 * `register()` contributes a lazily chosen backend (`createLazyDockerBackend`): the Docker Engine
 * API when the daemon is directly reachable, the CLI as the compatibility fallback, re-probed so a
 * daemon started after the app is picked up. It is contributed as a `BackendSubsystem`.
 * The boot-time loader
 * (`loadMiniAppBackends`) mounts the route (`/rpc/docker`), registers the resource
 * (`localix://resource/docker`) + global-search providers, and calls `onShutdown` on shutdown.
 *
 * It contributes NO agent tool. `docker_inspect` wrapped read verbs of a CLI the agent
 * already runs through `bash`, and paid ~220 tokens of schema on every request to do it.
 *
 * The long-lived children are the `docker events` stream (`events-stream.ts`), contributed as a
 * `k`-tagged WS-frame stream, and one `docker logs --follow` per container tab showing live logs
 * (`logs-follow.ts`, tag `l`); each runs only while a surface follows it and `onShutdown` stops them.
 */
import { createDockerService } from './service'
import { createDockerRoutes } from './routes'
import { createDockerResourceProvider } from './resource-provider'
import { createDockerSearchProvider } from './search-provider'
import { createDockerContextProvider } from './context-provider'
import { createLazyDockerBackend } from './backend-selection'
import { createDockerEventsHub, type DockerEventsHub } from './events-stream'
import {
  DOCKER_EVENTS_FRAME_TAG,
  DOCKER_EVENTS_SUBSCRIBE,
  DOCKER_EVENTS_UNSUBSCRIBE,
} from './events-contract'
import { createDockerLogsHub, createDockerLogsWsFrame } from './logs-follow'
import type { MiniAppRegistration, WsFrameContribution } from '@localixai/mini-app-sdk/backend'

/** The daemon's events are host-wide and carry no user data, so every socket shares one key. */
export function createDockerEventsWsFrame(hub: DockerEventsHub): WsFrameContribution {
  return {
    subscribeCommand: DOCKER_EVENTS_SUBSCRIBE,
    unsubscribeCommand: DOCKER_EVENTS_UNSUBSCRIBE,
    frameTag: DOCKER_EVENTS_FRAME_TAG,
    key: () => 'docker',
    start: (_params, send) => hub.subscribe((frame) => send(JSON.stringify(frame))),
    stop: (handle) => {
      if (typeof handle === 'function') (handle as () => void)()
    },
  }
}

export async function register(): Promise<MiniAppRegistration> {
  const service = createDockerService({ backend: createLazyDockerBackend() })
  const events = createDockerEventsHub()
  const logs = createDockerLogsHub()

  return {
    backend: [
      {
        id: 'devops:docker',
        routeMount: { path: '/rpc/docker', app: createDockerRoutes(service) },
        resourceProvider: createDockerResourceProvider(service),
        contextProviders: [createDockerContextProvider(service)],
        searchProvider: createDockerSearchProvider({
          listContainers: () =>
            service
              .listContainers()
              .then((cs) =>
                cs.map((c) => ({ id: c.id, name: c.name, image: c.image, state: c.state })),
              ),
          listImages: () =>
            service
              .listImages()
              .then((is) => is.map((i) => ({ id: i.id, repository: i.repository, tag: i.tag }))),
        }),
        wsFrames: [createDockerEventsWsFrame(events), createDockerLogsWsFrame(logs)],
        onShutdown: () => {
          events.stopAll()
          logs.stopAll()
        },
      },
    ],
    tools: [],
  }
}
