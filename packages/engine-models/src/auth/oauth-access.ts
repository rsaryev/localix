/**
 * AN OAUTH CREDENTIAL KEPT FRESH FOR A WHOLE RUN. A run binds its model once, but a Copilot token
 * lives about thirty minutes and a long run outlasts it. So every request asks for the credential
 * again (refreshing it close to expiry), and a request the provider refuses with 401 refreshes it
 * once and is sent again.
 *
 * A refresh happens inside the store's serialized `modify`, so two runs refreshing at once never
 * lose the newer refresh token, and it runs on its own deadline, never the run's signal: a stop
 * that lands after the provider rotated the refresh token would otherwise lose the new one.
 */
import type { RuntimeCredentialStore, RuntimeOAuthCredential } from '@localixai/agent/runtime'

import type { ProviderAccess } from '../providers/connect'
import type { OAuthFlow } from './flows/types'

/** Refresh a token this long before it lapses. */
const REFRESH_MARGIN_MS = 60_000
/** How long a refresh may take; a stopped run does not cut it short. */
const REFRESH_TIMEOUT_MS = 30_000

const stale = (credential: RuntimeOAuthCredential) =>
  credential.expiresAt - Date.now() < REFRESH_MARGIN_MS

/**
 * The credential to send: the stored one, refreshed when stale — or, after a 401, when it is still
 * the token that was refused (another run may already have replaced it).
 */
export async function freshOAuth(
  providerId: string,
  snapshot: RuntimeOAuthCredential,
  flow: OAuthFlow,
  store: RuntimeCredentialStore | undefined,
  refused?: string,
): Promise<RuntimeOAuthCredential> {
  const needs = (credential: RuntimeOAuthCredential) =>
    stale(credential) || credential.accessToken === refused
  const refresh = (credential: RuntimeOAuthCredential) =>
    flow.refresh(credential, AbortSignal.timeout(REFRESH_TIMEOUT_MS))
  if (!store) return needs(snapshot) ? refresh(snapshot) : snapshot
  const current = await store.read(providerId)
  const stored = current?.type === 'oauth' ? current : snapshot
  if (!needs(stored)) return stored
  const refreshed = await store.modify(providerId, async (latest) => {
    const base = latest?.type === 'oauth' ? latest : stored
    // Another run may have refreshed while this one waited for the lock.
    return needs(base) ? refresh(base) : undefined
  })
  if (refreshed?.type === 'oauth') return refreshed
  const latest = await store.read(providerId)
  return latest?.type === 'oauth' ? latest : stored
}

/** A request body that can be sent twice. A stream cannot. */
const replayable = (init: RequestInit | undefined) =>
  init?.body === undefined || init.body === null || typeof init.body === 'string'

/** The request's headers with one credential's values swapped for another's. */
function swapCredential(
  input: string | URL | Request,
  init: RequestInit | undefined,
  from: ProviderAccess,
  to: ProviderAccess,
): [string | URL | Request, RequestInit] {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
  const secrets = [from.authToken, from.apiKey].filter((value): value is string => !!value)
  const next = to.authToken ?? to.apiKey ?? ''
  headers.forEach((value, name) => {
    for (const secret of secrets) {
      if (value === secret) headers.set(name, next)
      else if (value === `Bearer ${secret}`) headers.set(name, `Bearer ${next}`)
    }
  })
  for (const [name, value] of Object.entries(to.headers ?? {})) headers.set(name, value)
  // A Copilot token names its own host; a refreshed one may name another.
  let target = input
  const url = input instanceof Request ? input.url : String(input)
  if (from.baseURL && to.baseURL && from.baseURL !== to.baseURL && url.startsWith(from.baseURL))
    target = to.baseURL + url.slice(from.baseURL.length)
  return [target, { ...init, headers }]
}

/**
 * Request access whose credential is checked before every request. The SDK model is built with
 * the first credential; each request swaps in the current one.
 */
export function refreshingAccess(
  providerId: string,
  first: RuntimeOAuthCredential,
  flow: OAuthFlow,
  store: RuntimeCredentialStore | undefined,
  request: { sessionId?: string },
): ProviderAccess {
  const built = flow.access(first, request)
  const base = built.fetch ?? globalThis.fetch
  let current = first
  let pending: Promise<RuntimeOAuthCredential> | undefined
  const renew = (refused?: string) =>
    (pending ??= freshOAuth(providerId, current, flow, store, refused)
      .then((credential) => (current = credential))
      .finally(() => (pending = undefined)))
  const send = (
    credential: RuntimeOAuthCredential,
    input: string | URL | Request,
    init?: RequestInit,
  ) =>
    credential === first
      ? base(input, init)
      : base(...swapCredential(input, init, built, flow.access(credential, request)))

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const used = stale(current) ? await renew() : current
    const response = await send(used, input, init)
    if (response.status !== 401 || !replayable(init)) return response
    const next = await renew(used.accessToken).catch(() => used)
    if (next.accessToken === used.accessToken) return response
    await response.body?.cancel().catch(() => undefined)
    return send(next, input, init)
  }
  return { ...built, fetch: fetch as typeof globalThis.fetch }
}
