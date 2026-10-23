import { createDockerApiBackend } from './api-backend'
import { createDockerBackend, type ContainerEngineBackend } from './backend'
import { connectDockerApi, type DockerApiClient } from './api-transport'

type DockerConnection = { client: DockerApiClient } | { client: null; reason: string }

export interface DockerBackendSelectionOptions {
  connect?: () => Promise<DockerConnection>
  cli?: ContainerEngineBackend
  debug?: (message: string) => void
}

/**
 * Prefer the Engine API and retain the CLI as a compatibility ladder.
 *
 * `ssh://`, TLS, an unsupported daemon API, and an unreachable socket are intentional fallback
 * outcomes. The reason is debug-only because Docker may legitimately be absent on this machine.
 */
export async function selectDockerBackend(
  options: DockerBackendSelectionOptions = {},
): Promise<ContainerEngineBackend> {
  const cli = options.cli ?? createDockerBackend()
  const connection = await (options.connect ?? connectDockerApi)()
  if (!connection.client) {
    const debug = options.debug ?? ((message: string) => console.debug(message))
    debug(`[devops/docker] Engine API unavailable; using CLI fallback: ${connection.reason}`)
    return cli
  }
  return createDockerApiBackend({ client: connection.client, cli })
}

/** How long a CLI fallback stands before the Engine API is probed again. */
export const DOCKER_REPROBE_MS = 30_000

/** Every method of the port, so the lazy backend cannot silently miss one the interface gains. */
const BACKEND_METHODS: Record<keyof ContainerEngineBackend, true> = {
  listContainers: true,
  listImages: true,
  listVolumes: true,
  listNetworks: true,
  containerLogs: true,
  containerStats: true,
  containerTop: true,
  startContainer: true,
  stopContainer: true,
  restartContainer: true,
  removeContainer: true,
  removeImage: true,
  removeVolume: true,
  removeNetwork: true,
  prune: true,
  composeAvailable: true,
  composeUp: true,
}

/**
 * The backend chosen on first USE, not at mini app registration.
 *
 * Choosing once in `register()` pinned the CLI fallback for the whole process whenever Docker
 * Desktop was not running yet at app launch — starting it later never brought the Engine API
 * back — and a stale socket held mini app registration for the full request timeout. Now only a
 * successful API connection is kept; a fallback is served for {@link DOCKER_REPROBE_MS} and then
 * the API is probed again, one probe at a time.
 */
export function createLazyDockerBackend(
  options: DockerBackendSelectionOptions & { reprobeMs?: number; now?: () => number } = {},
): ContainerEngineBackend {
  const cli = options.cli ?? createDockerBackend()
  const reprobeMs = options.reprobeMs ?? DOCKER_REPROBE_MS
  const now = options.now ?? Date.now
  let api: ContainerEngineBackend | null = null
  let fellBackAt = Number.NEGATIVE_INFINITY
  let probe: Promise<ContainerEngineBackend> | null = null

  const current = (): Promise<ContainerEngineBackend> => {
    if (api) return Promise.resolve(api)
    if (now() - fellBackAt < reprobeMs) return Promise.resolve(cli)
    probe ??= selectDockerBackend({ ...options, cli })
      .catch(() => cli)
      .then((chosen) => {
        if (chosen === cli) fellBackAt = now()
        else api = chosen
        return chosen
      })
      .finally(() => {
        probe = null
      })
    return probe
  }

  const backend: Record<string, unknown> = {}
  for (const method of Object.keys(BACKEND_METHODS) as (keyof ContainerEngineBackend)[]) {
    backend[method] = async (...args: unknown[]) => {
      const target = (await current()) as unknown as Record<string, (...a: unknown[]) => unknown>
      return target[method]!(...args)
    }
  }
  return backend as unknown as ContainerEngineBackend
}
