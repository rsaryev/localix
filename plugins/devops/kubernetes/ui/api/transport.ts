/**
 * The Kubernetes RPC transport: the typed error, the GET/POST helpers over
 * `pluginApiFetch`, and the shared query-string builder.
 *
 * Split from `kubernetesApi.ts` so that file is only the call surface, and so a
 * transport concern (a header, an error shape, the base path) has one home.
 */
import { pluginApiFetch, problemRequestOf } from '@localixai/plugin-sdk/ui/transport'
import type { Prerequisite } from '@localixai/plugin-sdk/prerequisite'
import type { ProblemRequest } from '@localixai/plugin-sdk/ui/problems'

import type { KubeErrorCode } from '../../backend/errors'
import { hasApiFailure, parseApiFailure } from '../../../ui/apiFailure'

export class KubeApiError extends Error {
  readonly code?: KubeErrorCode
  readonly detail?: string
  /** A stopped local engine or a missing credential helper. */
  readonly prerequisite?: Prerequisite
  /** The call that failed — the Event Center traces exactly this request. */
  readonly request?: ProblemRequest
  constructor(
    message: string,
    code?: KubeErrorCode,
    detail?: string,
    extra: { prerequisite?: Prerequisite; request?: ProblemRequest } = {},
  ) {
    super(message)
    this.name = 'KubeApiError'
    this.code = code
    this.detail = detail
    this.prerequisite = extra.prerequisite
    this.request = extra.request
  }
}

async function readOr<T>(res: Response, method: string): Promise<T> {
  const json = (await res.json().catch(() => null)) as T | null
  if (!res.ok || hasApiFailure(json)) {
    const failure = parseApiFailure<KubeErrorCode>(json, res.status)
    throw new KubeApiError(failure.message, failure.code, failure.detail, {
      prerequisite: failure.prerequisite,
      request: problemRequestOf(res, method),
    })
  }
  return json as T
}

const base = '/rpc/kubernetes'

/** GET a backend path and parse the typed body (or throw a `KubeApiError`). */
export async function get<T>(path: string): Promise<T> {
  return readOr<T>(await pluginApiFetch(`${base}${path}`), 'GET')
}

/** POST a backend path (JSON body when given) and parse the typed body. */
export async function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
  return readOr<T>(await pluginApiFetch(`${base}${path}`, init), 'POST')
}

/** Build a `?context=&namespace=` query string, omitting blanks. */
export function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
