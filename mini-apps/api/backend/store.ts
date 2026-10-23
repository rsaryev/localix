/**
 * REDACTION — what a stored request looks like to anything outside this process.
 *
 * (This file used to own a per-user entity store under `~/.localix` as well. Requests now live as
 * session-owned JSON under the workspace's ignored `.localix/` directory, and that store refuses
 * a literal credential outright rather than persisting one. What is left here is the vocabulary
 * both sides still need.)
 *
 * CREDENTIALS: the shape on disk is a `${secret:KEY}` token in the auth block, resolved at send
 * time against the central write-only vault. A literal reaching this process (pasted into a cURL
 * command, typed into the auth editor) is moved into the vault before it can be written, so
 * `redactAuth` covers the window where one is still in memory and heading for a model or a client.
 */

import { hasSecretTokens } from '@localixai/mini-app-sdk/backend'
import {
  credentialHeaders,
  credentialQueryPairs,
  redactUrlCredentials,
} from './request-credentials'
import type { Pair, RequestAuth, RequestSpec } from './request-spec'

/** The mask a literal credential wears on the wire. Exported so the auth-edit path can treat an
 *  unchanged masked field as "keep the stored secret" — the browser never sees the real value, so
 *  it must be able to save the block back without clobbering what it could not read. */
export const REDACTED = '••••••'

/**
 * Replace literal credentials with a mask, leaving `${secret:KEY}` references legible.
 *
 * The distinction is the point: a vault reference is not a secret, it's a POINTER to one, and
 * showing it is how the model learns which key a request uses and that the pattern exists.
 * A literal is the secret itself and never leaves this process.
 */
export function redactAuth(auth: RequestAuth): RequestAuth {
  const mask = (value: string) => (hasSecretTokens(value) ? value : REDACTED)
  switch (auth.type) {
    case 'basic':
      return { ...auth, password: mask(auth.password) }
    case 'bearer':
      return { ...auth, token: mask(auth.token) }
    case 'apikey':
      return { ...auth, value: mask(auth.value) }
    // Nothing to redact. Named rather than swept into a `default`: a new auth variant must fail
    // to compile here, because the failure mode of forgetting it is leaking its credential.
    case 'none':
      return auth
  }
}

/**
 * Mask a credential carried in a HEADER.
 *
 * `redactAuth` covers the auth block; this covers the other place credentials actually live. An
 * `Authorization`, `Cookie` or `X-Api-Key` header reaches model-facing text (`resource-provider`'s expansion,
 * captured into the Context Fabric) and the browser (`routes`' `toInfo`) — and for fourteen
 * iterations both went out in the clear, because every guard here reasoned about `spec.auth` while
 * the HAR and cURL importers deliberately put credentials in headers instead.
 */
export function redactHeaders(headers: readonly Pair[]): Pair[] {
  return redactCredentialPairs(headers, credentialHeaders)
}

/**
 * Mask a credential carried in the QUERY STRING — either as a `query` pair or inline in the url.
 *
 * The third place credentials live, and it was uncovered: `redactSpec` handled `auth` and `headers`
 * while `?api_key=sk-live-…` typed into the url (or imported from a cURL / HAR) went out verbatim to
 * every model-facing surface — `resource-provider`'s expansion into the Context Fabric, the browser's
 * `toInfo`, the cURL export, search hits, and the `api_client` tool's spec dump. `reportUrl` in
 * `send.ts` masked only the parameter NAMED BY THE AUTH BLOCK, so a literal had nothing covering it.
 */
export function redactQuery(query: readonly Pair[]): Pair[] {
  return redactCredentialPairs(query, credentialQueryPairs)
}

/** Keep unmasked pairs by identity; clone only the rows whose credential values need masking. */
function redactCredentialPairs(
  pairs: readonly Pair[],
  credentials: (pairs: readonly Pair[]) => Pair[],
): Pair[] {
  const leaky = new Set(credentials(pairs).map((pair) => pair.name))
  return pairs.map((pair) =>
    leaky.has(pair.name) && !hasSecretTokens(pair.value) ? { ...pair, value: REDACTED } : pair,
  )
}

export function redactSpec(spec: RequestSpec): RequestSpec {
  return {
    ...spec,
    // `${secret:KEY}` reads through, as everywhere else: a pointer is not a secret.
    url: hasSecretTokens(spec.url) ? spec.url : redactUrlCredentials(spec.url, REDACTED),
    auth: redactAuth(spec.auth),
    headers: redactHeaders(spec.headers),
    query: redactQuery(spec.query),
  }
}
