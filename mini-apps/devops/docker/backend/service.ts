import type { ContainerEngineBackend } from './backend'
import { createDockerBackend } from './backend'

/**
 * Docker workbench service — a thin, stateless pass-through over the
 * {@link ContainerEngineBackend} port (same surface; the only service-level
 * behaviour is memoizing the compose probe). No per-user registry (unlike the
 * database workbench): the container engine is a single host-wide daemon, so
 * there is nothing to persist. Errors flow up as typed {@link DockerError} from
 * the backend and are serialised by the routes.
 */
export interface DockerService extends ContainerEngineBackend {}

export interface DockerServiceOptions {
  /** Injectable selected backend; direct construction retains the CLI-compatible default. */
  backend?: ContainerEngineBackend
}

/** How long a negative Compose probe stands before it is asked again. */
export const COMPOSE_NEGATIVE_TTL_MS = 60_000

export function createDockerService(options: DockerServiceOptions = {}): DockerService {
  const backend = options.backend ?? createDockerBackend()
  // A PRESENT Compose mini app does not vanish mid-process, so `true` is memoized for good. `false`
  // is not: it was also the answer while the CLI could not be found at all (the packaged app's PATH
  // bug) or before the person installed Docker, and memoized it hid the Up action until a restart.
  // It is re-probed after a minute instead — rare enough that UI polls stay free.
  let composeProbe: Promise<boolean> | undefined
  let negativeAt = 0
  return {
    ...backend,
    composeAvailable: () => {
      if (composeProbe && negativeAt && Date.now() - negativeAt > COMPOSE_NEGATIVE_TTL_MS) {
        composeProbe = undefined
        negativeAt = 0
      }
      composeProbe ??= backend.composeAvailable().then((available) => {
        if (!available) negativeAt = Date.now()
        return available
      })
      return composeProbe
    },
  }
}
