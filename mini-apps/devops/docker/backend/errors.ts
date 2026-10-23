/**
 * Docker workbench error mapping. The container engine can be entirely absent (no
 * Docker installed, daemon down) — that must surface as a clean typed code the UI
 * renders as an empty state, NEVER an unhandled 500. Raw CLI stderr is pattern-matched
 * into a small stable vocabulary; the raw text is kept as `detail` for operators.
 *
 * The typed-error SKELETON (the error class, `toErrorInfo`, `rawOf`) is the shared
 * `defineTypedError` kit — four workbenches had hand-rolled it identically. What stays
 * here is the only part with domain content in it: the FRIENDLY sentences and
 * {@link mapDockerError}'s stderr classification.
 */

import {
  defineTypedError,
  type TypedDomainError,
  // The narrow entrypoint, matching the Kubernetes side. Docker's UI imports `DockerErrorCode`
  // from here as a TYPE today, so the barrel was erased at build time and nothing detonated —
  // but that is one non-type import away from the same failure, and the two providers should
  // not differ on a rule this sharp.
} from '@localixai/mini-app-sdk/typed-error'

import { isMissingExecutable, type Prerequisite } from '@localixai/mini-app-sdk/prerequisite'

import { DockerTransportError } from './api-transport'

export type DockerErrorCode = 'engine_unavailable' | 'not_found' | 'action_failed' | 'engine_error'

const FRIENDLY: Record<DockerErrorCode, string> = {
  engine_unavailable: 'Docker is not available — is Docker installed and the daemon running?',
  not_found: 'No such Docker object.',
  action_failed: 'The Docker action failed.',
  engine_error: 'Docker could not complete the request.',
}

export const DOCKER_INSTALL_URL = 'https://docs.docker.com/get-started/get-docker/'

/**
 * The command that starts THIS machine's engine, read off the socket the failure names.
 *
 * "Start Docker" is wrong advice on a machine that runs OrbStack or Colima, and the socket path in
 * the daemon's own error is the one reliable statement of which engine the context points at. With
 * no path to go on, the platform's common engine is the guess. Windows gets no command: Docker
 * Desktop is started from the Start menu, and a line pasted into a bash terminal would not do it.
 */
export function dockerStartCommand(raw: string, platform: string): string | undefined {
  const low = raw.toLowerCase()
  if (low.includes('.orbstack')) return platform === 'darwin' ? 'open -a OrbStack' : 'orb start'
  if (low.includes('.colima')) return 'colima start'
  if (low.includes('.rd/')) return platform === 'darwin' ? 'open -a "Rancher Desktop"' : undefined
  if (platform === 'darwin') return 'open -a Docker'
  if (platform === 'linux') {
    return low.includes('.docker/desktop')
      ? 'systemctl --user start docker-desktop'
      : 'sudo systemctl start docker'
  }
  return undefined
}

function dockerPrerequisite(state: Prerequisite['state'], command?: string): Prerequisite {
  return {
    id: 'docker',
    name: 'Docker',
    state,
    installUrl: DOCKER_INSTALL_URL,
    ...(command ? { command } : {}),
  }
}

/** Where the classifier runs. The backend passes the real platform; tests pass any. */
export interface DockerErrorContext {
  platform?: string
}

const currentPlatform = (): string =>
  typeof process !== 'undefined' && typeof process.platform === 'string'
    ? process.platform
    : 'darwin'

const kit = defineTypedError<DockerErrorCode>('DockerError', FRIENDLY)

export const DockerError = kit.DomainError
export type DockerError = TypedDomainError<DockerErrorCode>
export const toErrorInfo = kit.toErrorInfo
const rawOf = kit.rawOf

/**
 * Collapse an arbitrary thrown value / CLI stderr into a typed {@link DockerError}.
 * Pure + exported so the parser tests can pin the classification.
 */
export function mapDockerError(err: unknown, context: DockerErrorContext = {}): DockerError {
  if (err instanceof DockerError) return err
  const raw = rawOf(err)
  const low = raw.toLowerCase()
  // The `docker` program itself is absent — Bun's `Executable not found in $PATH: "docker"`, which
  // no pattern below matched, is how the packaged app's sidebar came to read "Docker returned an
  // error." Tested FIRST: a missing CLI must not be mistaken for a stopped daemon.
  if (isMissingExecutable(err) || low.includes('docker_not_found')) {
    return new DockerError('engine_unavailable', raw || undefined, {
      cause: err,
      prerequisite: dockerPrerequisite('missing'),
    })
  }
  // The Engine API path carries the transport's own verdict: status 0 means the daemon never
  // answered, an HTTP status is the daemon's answer. No wording needs to be guessed.
  if (err instanceof DockerTransportError) {
    if (err.status === 0) return stoppedEngine(err, raw, context)
    if (err.status === 404) return new DockerError('not_found', raw || undefined, { cause: err })
    return new DockerError('engine_error', raw || undefined, { cause: err })
  }
  if (
    low.includes('cannot connect to the docker daemon') ||
    // Observed from Docker Desktop on macOS, and previously misread as `not_found` because its
    // tail is "no such file or directory": `connect to the docker API at unix:///Users/…/
    // docker.sock; check if the path is correct and if the daemon is running: dial unix …:
    // connect: no such file or directory`. A dead socket is an absent engine, not a missing object.
    low.includes('connect to the docker api') ||
    low.includes('error during connect') ||
    low.includes('is the docker daemon running') ||
    low.includes('the daemon is running') ||
    low.includes('docker command timed out') ||
    low.includes('connection refused') ||
    low.includes('docker.sock') ||
    // Docker Desktop's proxy socket answers while its VM is stopped or paused.
    low.includes('docker desktop is') ||
    low.includes('is manually paused')
  ) {
    return stoppedEngine(err, raw, context)
  }
  // `no such container|object|volume|network|image|…` — Docker phrases a missing
  // target as "No such <kind>". `engine_unavailable` is tested first above, so a
  // daemon-down error never falls in here.
  if (low.includes('no such ')) {
    return new DockerError('not_found', raw || undefined, { cause: err })
  }
  return new DockerError('engine_error', raw || undefined, { cause: err })
}

function stoppedEngine(err: unknown, raw: string, context: DockerErrorContext): DockerError {
  const command = dockerStartCommand(raw, context.platform ?? currentPlatform())
  return new DockerError('engine_unavailable', raw || undefined, {
    cause: err,
    prerequisite: dockerPrerequisite('stopped', command),
  })
}
