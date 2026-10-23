import type {
  ContainerLogs,
  ContainerStats,
  ContainerTop,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  PruneResult,
  PruneTarget,
} from './contracts'
import { DOCKER_ACTION_TIMEOUT_MS, DOCKER_REQUEST_TIMEOUT_MS } from './api-transport'
import { DockerError, mapDockerError } from './errors'
import { detectInstalledEngine, type InstalledEngine } from './installed-engine'
import { readProcessOutputWithTimeout, toolEnv } from '@localixai/mini-app-sdk/backend'
import {
  parseComposeProjectPaths,
  parseContainers,
  parseImages,
  parseNetworks,
  parseStats,
  parseTop,
  parseVolumes,
} from './parse'

/**
 * Engine-neutral container backend port. The workbench talks to THIS interface
 * only; the implementations below it may use the Engine API or the `docker` CLI fallback. A future
 * podman/containerd impl drops in behind the same
 * port with zero service/route changes — the same pattern the database workbench
 * uses for its `DbDriver` port.
 */
export interface ContainerEngineBackend {
  listContainers(): Promise<DockerContainer[]>
  listImages(): Promise<DockerImage[]>
  listVolumes(): Promise<DockerVolume[]>
  listNetworks(): Promise<DockerNetwork[]>
  containerLogs(id: string, tail: number, sinceSeconds?: number): Promise<ContainerLogs>
  containerStats(id: string): Promise<ContainerStats | null>
  containerTop(id: string): Promise<ContainerTop>
  startContainer(id: string): Promise<void>
  stopContainer(id: string): Promise<void>
  restartContainer(id: string): Promise<void>
  removeContainer(id: string, force: boolean): Promise<void>
  removeImage(id: string, force: boolean): Promise<void>
  removeVolume(name: string, force: boolean): Promise<void>
  removeNetwork(id: string): Promise<void>
  prune(target: PruneTarget): Promise<PruneResult>
  /** True when the `docker compose` CLI mini app is installed (cheap version probe). */
  composeAvailable(): Promise<boolean>
  /** Bring a Compose project up detached (`docker compose -p <project> up -d`). */
  composeUp(project: string): Promise<void>
}

/** Runs `docker` and returns stdout, or throws with stderr on a non-zero exit.
 *  `combineStderr` merges stderr into the returned text (for `docker logs`, which
 *  replays a container's stderr stream onto the host stderr). */
export type DockerExec = (args: string[], opts?: DockerExecOptions) => Promise<string>

interface DockerExecOptions {
  combineStderr?: boolean
  cwd?: string
  /** Overrides {@link DOCKER_COMMAND_TIMEOUT_MS} for a call that legitimately takes longer. */
  timeoutMs?: number
}

/** Default exec — spawns the `docker` CLI via Bun. Injectable for tests. */
export const DOCKER_COMMAND_TIMEOUT_MS = DOCKER_REQUEST_TIMEOUT_MS

/**
 * Calls that wait on the daemon doing real work. One 10s cap on every CLI call killed them while
 * they were still working: `docker stop` waits out the container's own 10s grace period, so it
 * raced the cap and reported "timed out" on a container that was still stopping, and a prune of a
 * large store routinely runs longer. Same budget as the Engine API path, from one constant.
 */
export const DOCKER_CLI_ACTION_TIMEOUT_MS = DOCKER_ACTION_TIMEOUT_MS

/** `compose up -d` may pull and build images first — minutes, not seconds. */
export const DOCKER_COMPOSE_UP_TIMEOUT_MS = 10 * 60_000

const defaultExec: DockerExec = async (args, opts) => {
  const proc = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    // The CURRENT environment, never Bun's start-time snapshot: without it the packaged app looked
    // `docker` up on launchd's bare PATH and failed on a machine where it was installed.
    env: toolEnv(),
    // Compose needs to resolve its manifest relative to a project dir, not the API cwd.
    ...(opts?.cwd ? { cwd: opts.cwd } : {}),
  })
  const { stdout, stderr, exitCode } = await readProcessOutputWithTimeout(
    proc,
    opts?.timeoutMs ?? DOCKER_COMMAND_TIMEOUT_MS,
    // `errors.ts` maps exactly this wording to a typed timeout.
    { label: 'Docker command' },
  )
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `docker exited with code ${exitCode}`)
  }
  return opts?.combineStderr ? [stdout, stderr].filter(Boolean).join('') : stdout
}

export interface DockerBackendOptions {
  /** Injectable exec so tests can drive the backend without a live daemon. */
  exec?: DockerExec
  /** Injectable engine probe — see {@link detectInstalledEngine}. */
  installedEngine?: () => InstalledEngine | null
}

/**
 * A missing CLI on a machine that HAS an engine is a stopped engine, not an absent one: say "Start
 * OrbStack", not "Install Docker". Anything else passes through unchanged.
 */
export function reclassifyMissingCli(
  error: DockerError,
  installedEngine: () => InstalledEngine | null,
): DockerError {
  if (error.prerequisite?.state !== 'missing') return error
  const engine = installedEngine()
  if (!engine) return error
  return new DockerError('engine_unavailable', error.message, {
    cause: error.cause,
    prerequisite: {
      ...error.prerequisite,
      state: 'stopped',
      ...(engine.command ? { command: engine.command } : {}),
    },
  })
}

/**
 * The docker CLI fallback implementation of {@link ContainerEngineBackend}. Every call maps
 * a raw failure (missing binary, daemon down, no-such-container) through
 * {@link mapDockerError} so callers get a typed {@link DockerError}.
 */
export function createDockerBackend(options: DockerBackendOptions = {}): ContainerEngineBackend {
  const exec = options.exec ?? defaultExec
  const installedEngine = options.installedEngine ?? (() => detectInstalledEngine())
  const run = async (args: string[], opts?: DockerExecOptions): Promise<string> => {
    try {
      return await exec(args, opts)
    } catch (err) {
      throw reclassifyMissingCli(mapDockerError(err), installedEngine)
    }
  }

  return {
    async listContainers() {
      return parseContainers(await run(['ps', '-a', '--no-trunc', '--format', '{{json .}}']))
    },
    async listImages() {
      return parseImages(await run(['images', '--no-trunc', '--format', '{{json .}}']))
    },
    async listVolumes() {
      return parseVolumes(await run(['volume', 'ls', '--format', '{{json .}}']))
    },
    async listNetworks() {
      return parseNetworks(await run(['network', 'ls', '--no-trunc', '--format', '{{json .}}']))
    },
    async containerStats(id) {
      // A single point-in-time sample (never a streaming attach). Docker computes
      // CPU%/mem% for us; a stopped container yields no line → null.
      const stats = parseStats(await run(['stats', '--no-stream', '--format', '{{json .}}', id]))
      return stats[0] ?? null
    },
    async containerTop(id) {
      return parseTop(await run(['top', id]))
    },
    async containerLogs(id, tail, sinceSeconds) {
      // `docker logs` replays the container's stdout AND stderr onto the matching
      // host streams, so `combineStderr` merges both — without it half the output
      // is silently lost. `--tail` bounds the volume.
      const args = ['logs', '--tail', String(tail), '--timestamps']
      if (sinceSeconds) args.push('--since', `${sinceSeconds}s`)
      args.push(id)
      const lines = await run(args, {
        combineStderr: true,
      })
      return { id, lines }
    },
    async startContainer(id) {
      await run(['start', id])
    },
    async stopContainer(id) {
      await run(['stop', id], { timeoutMs: DOCKER_CLI_ACTION_TIMEOUT_MS })
    },
    async restartContainer(id) {
      await run(['restart', id], { timeoutMs: DOCKER_CLI_ACTION_TIMEOUT_MS })
    },
    async removeContainer(id, force) {
      await run(force ? ['rm', '-f', id] : ['rm', id])
    },
    async removeImage(id, force) {
      // `-f` is required to remove a tagged image that is still referenced by a
      // (stopped) container or has multiple tags — the UI opts in per-request.
      await run(force ? ['rmi', '-f', id] : ['rmi', id])
    },
    async removeVolume(name, force) {
      await run(force ? ['volume', 'rm', '-f', name] : ['volume', 'rm', name])
    },
    async removeNetwork(id) {
      await run(['network', 'rm', id])
    },
    async prune(target) {
      // `docker <target> prune -f` — no interactive confirmation (the UI guards it).
      // Every PruneTarget is a regular plural of its CLI noun.
      const noun = target.slice(0, -1)
      const output = await run([noun, 'prune', '-f'], {
        combineStderr: true,
        timeoutMs: DOCKER_CLI_ACTION_TIMEOUT_MS,
      })
      return { target, output: output.trim() }
    },
    async composeAvailable() {
      // A cheap probe: `docker compose version` succeeds only when the Compose v2
      // CLI mini app is present. Any failure (old docker, no mini app) ⇒ unavailable,
      // never an error — the caller (service) memoizes this.
      try {
        await exec(['compose', 'version'])
        return true
      } catch {
        return false
      }
    },
    async composeUp(project) {
      // `docker compose` resolves its manifest RELATIVE to a working directory. The
      // API process cwd is not where the project lives, so recover the real location
      // from the compose labels Docker stamps onto the project's containers, then run
      // from there (working_dir) or point at its explicit config files. `-p <project>`
      // is a discrete argv token (never a shell string), so there is no injection
      // surface. A run from the wrong place would only accidentally work.
      const psOut = await run([
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--format',
        '{{json .}}',
      ])
      const paths = parseComposeProjectPaths(psOut)
      if (paths?.workingDir) {
        await run(['compose', '-p', project, 'up', '-d'], {
          combineStderr: true,
          cwd: paths.workingDir,
          timeoutMs: DOCKER_COMPOSE_UP_TIMEOUT_MS,
        })
        return
      }
      if (paths?.configFiles.length) {
        const fileArgs = paths.configFiles.flatMap((f) => ['-f', f])
        await run(['compose', ...fileArgs, '-p', project, 'up', '-d'], {
          combineStderr: true,
          timeoutMs: DOCKER_COMPOSE_UP_TIMEOUT_MS,
        })
        return
      }
      throw new DockerError(
        'action_failed',
        `Cannot locate the Compose manifest for project "${project}" — its containers carry no working_dir/config_files label (was it created outside docker compose?).`,
      )
    },
  }
}

export { DockerError }
