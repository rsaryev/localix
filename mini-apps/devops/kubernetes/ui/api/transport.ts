/**
 * The Kubernetes RPC transport: the typed error, the GET/POST helpers over
 * `miniAppApiFetch`, and the shared query-string builder.
 *
 * Split from `kubernetesApi.ts` so that file is only the call surface, and so a
 * transport concern (a header, an error shape, the base path) has one home.
 */
import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui/transport'

import type { KubeErrorCode } from '../../backend/errors'
import { DevOpsApiError, readApiResponse } from '../../../ui/apiFailure'

export class KubeApiError extends DevOpsApiError<KubeErrorCode> {
  override readonly name = 'KubeApiError'
}

const readOr = <T>(res: Response, method: string) =>
  readApiResponse<T, KubeErrorCode>(res, method, KubeApiError)

const base = '/rpc/kubernetes'

/** GET a backend path and parse the typed body (or throw a `KubeApiError`). */
export async function get<T>(path: string): Promise<T> {
  return readOr<T>(await miniAppApiFetch(`${base}${path}`), 'GET')
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
  return readOr<T>(await miniAppApiFetch(`${base}${path}`, init), 'POST')
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
