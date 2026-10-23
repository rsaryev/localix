import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { type DockerTransport, type HostEnvironment, resolveDockerTransport } from './docker-host'
import { type NegotiatedApi, negotiateApiVersion } from './api-version'

/**
 * The Docker Engine API over whatever endpoint this machine actually has.
 *
 * Replaces a `docker` CLI spawn per core call. The primary wins are structured responses and no
 * dependency on a `docker` executable being on PATH; latency varies by daemon and endpoint.
 *
 * Bun's `fetch(url, { unix })` carries both a unix socket and a Windows named pipe, so the two
 * kinds share one code path here; only the resolved path differs.
 *
 * This module owns the connection LIFECYCLE — resolution, negotiation, timeouts and the
 * decision that a daemon is unreachable. It deliberately owns no request shapes: those stay
 * with the callers, so adding an endpoint never means touching the transport.
 */

/** Bound every request. A hung daemon must not hang the workbench — the same reason the CLI
 *  path grew `DOCKER_COMMAND_TIMEOUT_MS`, applied at the layer that can actually abort. */
export const DOCKER_REQUEST_TIMEOUT_MS = 10_000

/** Longer, because `stats?stream=false` legitimately blocks ~2s on a pre-1.41 daemon. */
export const DOCKER_STATS_TIMEOUT_MS = 15_000

/** Stop/restart waits for the container's grace period (10s by default) before it returns. */
export const DOCKER_ACTION_TIMEOUT_MS = 30_000

export class DockerTransportError extends Error {
  /** HTTP status when the daemon answered, `0` when it could not be reached at all. */
  readonly status: number
  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DockerTransportError'
    this.status = status
  }
}

export interface DockerApiClient {
  /** The negotiated API version and the capabilities that come with it. */
  readonly api: NegotiatedApi
  /** How we are connected, for diagnostics the UI can show. */
  readonly transport: DockerTransport
  /** GET a versioned path and parse JSON. */
  get<T>(path: string, opts?: { timeoutMs?: number }): Promise<T>
  /** POST a versioned path; returns the parsed body, or `null` for a 204. */
  post<T>(path: string, opts?: { body?: unknown; timeoutMs?: number }): Promise<T | null>
  /** DELETE a versioned path. */
  del(path: string, opts?: { timeoutMs?: number }): Promise<void>
  /** GET a versioned path as text — log output is not JSON. */
  text(path: string, opts?: { timeoutMs?: number }): Promise<string>
  /** GET a versioned path without decoding it — multiplexed logs need the raw bytes + headers. */
  raw(path: string, opts?: { timeoutMs?: number }): Promise<Response>
}

/** The real machine, for production callers. */
export function currentHostEnvironment(): HostEnvironment {
  return {
    env: process.env,
    platform: process.platform,
    homeDir: homedir(),
    readTextFile: (path) => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        // Absent config is the normal case, not an error: it means "use the default host".
        return null
      }
    },
  }
}

/**
 * `fetch` init for a transport.
 *
 * A socket or pipe needs a syntactically valid URL that is never resolved — the host part is
 * ignored once `unix` is set, so `http://localhost` is a placeholder, not a connection.
 */
function requestFor(
  transport: DockerTransport,
  path: string,
): { url: string; init: RequestInit } | null {
  if (transport.kind === 'unix' || transport.kind === 'npipe') {
    return { url: `http://localhost${path}`, init: { unix: transport.path } as RequestInit }
  }
  if (transport.kind === 'tcp') return { url: `${transport.baseUrl}${path}`, init: {} }
  return null
}

function describeUnreachable(transport: DockerTransport): string {
  if (transport.kind === 'unix') return `Cannot connect to the Docker daemon at ${transport.path}`
  if (transport.kind === 'npipe') return `Cannot connect to the Docker daemon at ${transport.path}`
  if (transport.kind === 'tcp') return `Cannot connect to the Docker daemon at ${transport.baseUrl}`
  return transport.reason
}

async function send(
  transport: DockerTransport,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const request = requestFor(transport, path)
  if (!request) throw new DockerTransportError(describeUnreachable(transport), 0)
  try {
    return await fetch(request.url, {
      ...request.init,
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    // A refused socket, a missing pipe, a DNS failure and a timeout are all the same fact to
    // the caller: this daemon is not answering. The message keeps the phrasing the CLI uses,
    // because `mapDockerError` already classifies that wording as `engine_unavailable`.
    throw new DockerTransportError(describeUnreachable(transport), 0, { cause })
  }
}

async function failureFrom(response: Response, path: string): Promise<DockerTransportError> {
  // The daemon's error bodies are `{"message":"..."}`; falling back to the status keeps a
  // truncated or HTML response from surfacing as `[object Object]`.
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null
  const message =
    typeof body?.message === 'string' && body.message.trim()
      ? body.message
      : `Docker API ${response.status} for ${path}`
  return new DockerTransportError(message, response.status)
}

/**
 * Connect to the daemon, or report why we cannot.
 *
 * `null` is a NORMAL outcome and means "fall back to the CLI": an `ssh://` or TLS endpoint we
 * deliberately do not speak, a daemon below our version floor, or a socket that is simply not
 * there because Docker is not running. The caller keeps working in every one of those cases,
 * which is the whole point of not making this the only path.
 */
export async function connectDockerApi(
  environment: HostEnvironment = currentHostEnvironment(),
): Promise<{ client: DockerApiClient } | { client: null; reason: string }> {
  const transport = resolveDockerTransport(environment)
  if (transport.kind === 'cli') return { client: null, reason: transport.reason }

  let version: unknown
  try {
    // `/version` is unversioned on purpose — asking it with a version prefix is the one request
    // that could fail BECAUSE we do not know the version yet.
    const response = await send(transport, '/version', {}, DOCKER_REQUEST_TIMEOUT_MS)
    if (!response.ok) return { client: null, reason: `Docker API ${response.status} from /version` }
    version = await response.json()
  } catch (cause) {
    return {
      client: null,
      reason: cause instanceof Error ? cause.message : describeUnreachable(transport),
    }
  }

  const info = (version ?? {}) as Record<string, unknown>
  const api = negotiateApiVersion({
    apiVersion: info.ApiVersion,
    minApiVersion: info.MinAPIVersion,
    os: info.Os,
  })
  if (!api) {
    return {
      client: null,
      // Not `String(...)`: a daemon that answered with an object here would stringify to
      // `[object Object]` in the very message meant to explain the problem.
      reason: `Docker API version ${typeof info.ApiVersion === 'string' ? info.ApiVersion : 'unknown'} is outside the supported range`,
    }
  }

  const prefix = `/v${api.version}`
  const request = async (
    path: string,
    init: RequestInit,
    timeoutMs = DOCKER_REQUEST_TIMEOUT_MS,
  ): Promise<Response> => {
    const response = await send(transport, `${prefix}${path}`, init, timeoutMs)
    if (!response.ok) throw await failureFrom(response, path)
    return response
  }

  return {
    client: {
      api,
      transport,
      async get<T>(path: string, opts?: { timeoutMs?: number }) {
        return (await request(path, {}, opts?.timeoutMs)).json() as Promise<T>
      },
      async post<T>(path: string, opts?: { body?: unknown; timeoutMs?: number }) {
        const response = await request(
          path,
          opts?.body === undefined
            ? { method: 'POST' }
            : {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(opts.body),
              },
          opts?.timeoutMs,
        )
        // Most Docker mutations answer 204 with no body; parsing that would throw.
        if (response.status === 204) return null
        return (await response.json().catch(() => null)) as T | null
      },
      async del(path: string, opts?: { timeoutMs?: number }) {
        await request(path, { method: 'DELETE' }, opts?.timeoutMs)
      },
      async text(path: string, opts?: { timeoutMs?: number }) {
        return (await request(path, {}, opts?.timeoutMs)).text()
      },
      async raw(path: string, opts?: { timeoutMs?: number }) {
        return request(path, {}, opts?.timeoutMs)
      },
    },
  }
}
