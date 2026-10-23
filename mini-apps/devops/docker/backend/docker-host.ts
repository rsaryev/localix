import { createHash } from 'node:crypto'

/**
 * Resolve WHERE the Docker daemon is, the way the `docker` CLI itself does.
 *
 * A stock Docker Desktop install is the argument for doing it properly: `~/.docker/config.json`
 * names the `desktop-linux` context, whose endpoint is
 * `unix:///Users/<me>/.docker/run/docker.sock`. A hardcoded `/var/run/docker.sock` only works there
 * because Docker Desktop happened to create a root-owned symlink to that user socket — and it does
 * not create one under colima, Rancher Desktop, podman, a rootless daemon, or a plain
 * `docker context use`.
 *
 * Resolution follows Docker CLI precedence: an explicit environment setting, then the
 * selected context, then the platform default.
 *
 * Pure: env, platform and file reads are all injected, so every branch — including the
 * Windows one, which cannot be exercised on a developer's Mac — is unit-testable.
 */

/** How we can talk to the daemon we found. */
export type DockerTransport =
  /** A unix domain socket. Bun's `fetch(url, { unix })` speaks this directly. */
  | { kind: 'unix'; path: string }
  /**
   * A Windows named pipe. Bun's `unix` option takes a bare `\\.\pipe\name` path — its
   * socket handler strips only `file://`/`unix://`/`sock://` prefixes and passes the rest
   * to the kernel unchanged — so the same option carries both.
   */
  | { kind: 'npipe'; path: string }
  /** A plain TCP daemon (`tcp://host:2375`, `http://…`). */
  | { kind: 'tcp'; baseUrl: string }
  /**
   * Something we deliberately do NOT speak natively; the caller shells out to `docker`,
   * which already knows how.
   *
   * `ssh://` needs a tunnel the CLI sets up for us, and a TLS-verified TCP daemon needs the
   * client cert/key pair from `DOCKER_CERT_PATH`. Both are real setups, and answering them
   * with a half-working native client would be worse than answering them with the CLI —
   * `reason` exists so the UI can say WHY it is on the slower path.
   */
  | { kind: 'cli'; reason: string }

export interface HostEnvironment {
  env: Record<string, string | undefined>
  /** `process.platform`. */
  platform: string
  /** `null` when the file does not exist or cannot be read — never throws. */
  readTextFile: (path: string) => string | null
  homeDir: string
}

/** The per-platform fallback used when neither the environment nor a context supplies a host. */
export function defaultDockerHost(platform: string): string {
  return platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock'
}

/** `npipe:////./pipe/docker_engine` → `\\.\pipe\docker_engine`, moby's own conversion. */
function npipePath(rest: string): string {
  return rest.replaceAll('/', '\\')
}

/** Turn a `DOCKER_HOST`-style URL into a transport. */
export function parseDockerHost(value: string): DockerTransport {
  const host = value.trim()
  if (!host) return { kind: 'cli', reason: 'No Docker host configured' }

  if (host.startsWith('unix://')) return { kind: 'unix', path: host.slice('unix://'.length) }
  if (host.startsWith('npipe://'))
    return { kind: 'npipe', path: npipePath(host.slice('npipe://'.length)) }
  // A bare path is what a hand-edited config or `DOCKER_HOST=/var/run/docker.sock` produces.
  if (host.startsWith('/')) return { kind: 'unix', path: host }
  if (host.startsWith('\\\\')) return { kind: 'npipe', path: host }

  if (host.startsWith('ssh://')) {
    return { kind: 'cli', reason: 'SSH Docker hosts need the tunnel the docker CLI sets up' }
  }

  if (host.startsWith('tcp://') || host.startsWith('http://') || host.startsWith('https://')) {
    const withoutScheme = host.replace(/^[a-z]+:\/\//, '')
    // `tcp://` means TLS only when the daemon says so; `https://` says so outright, and then
    // we need the client certificate pair — which is the CLI's job.
    if (host.startsWith('https://')) {
      return {
        kind: 'cli',
        reason: 'TLS Docker daemons need the client certificates from DOCKER_CERT_PATH',
      }
    }
    return { kind: 'tcp', baseUrl: `http://${withoutScheme.replace(/\/+$/, '')}` }
  }

  return { kind: 'cli', reason: `Unsupported Docker host scheme: ${host}` }
}

/** `DOCKER_CONFIG`, else `~/.docker` — the CLI's config directory. */
export function dockerConfigDir(environment: HostEnvironment): string {
  const override = environment.env.DOCKER_CONFIG?.trim()
  return override || `${environment.homeDir}/.docker`
}

/**
 * The on-disk path of a context's metadata.
 *
 * The directory name is the hex sha256 of the context NAME. Verified against a real store:
 * `sha256("desktop-linux")` is `fe9c6bd7a663…da791e`, which is exactly the directory Docker
 * Desktop created here.
 */
export function contextMetaPath(environment: HostEnvironment, contextName: string): string {
  const digest = createHash('sha256').update(contextName).digest('hex')
  return `${dockerConfigDir(environment)}/contexts/meta/${digest}/meta.json`
}

function readJson(environment: HostEnvironment, path: string): Record<string, unknown> | null {
  const text = environment.readTextFile(path)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** The `docker` endpoint host recorded for a context, or `''` when there is none. */
export function contextHost(environment: HostEnvironment, contextName: string): string {
  const meta = readJson(environment, contextMetaPath(environment, contextName))
  const endpoint = record(record(meta?.Endpoints)?.docker)
  const host = endpoint?.Host
  return typeof host === 'string' ? host.trim() : ''
}

/** Which context is selected: `DOCKER_CONTEXT`, else the config file's `currentContext`. */
export function currentContextName(environment: HostEnvironment): string {
  const fromEnv = environment.env.DOCKER_CONTEXT?.trim()
  if (fromEnv) return fromEnv
  const config = readJson(environment, `${dockerConfigDir(environment)}/config.json`)
  const current = config?.currentContext
  return typeof current === 'string' ? current.trim() : ''
}

/**
 * The daemon endpoint for this machine, in the CLI's own order of precedence.
 *
 * 1. `DOCKER_HOST` — explicit, wins over everything.
 * 2. The selected context's `docker` endpoint.
 * 3. The platform default.
 *
 * A context named `default` is NOT looked up in the store: the CLI treats it as "the
 * platform's own daemon", and on Windows it is what actually gets written into the config.
 * A context that exists but records an empty host falls through to the default too — that is
 * what `docker context create foo --docker "host="` produces, and the CLI tolerates it.
 */
export function resolveDockerTransport(environment: HostEnvironment): DockerTransport {
  const explicit = environment.env.DOCKER_HOST?.trim()
  if (explicit) return parseDockerHost(explicit)

  const contextName = currentContextName(environment)
  if (contextName && contextName !== 'default') {
    const host = contextHost(environment, contextName)
    if (host) return parseDockerHost(host)
  }

  return parseDockerHost(defaultDockerHost(environment.platform))
}
