/** Redact credentials an upstream server reflects back in its response. */

import { hasSecretTokens } from '@localixai/mini-app-sdk/backend'
import type { ResponseCookie } from './contracts'
import { credentialHeaders, credentialQueryPairs, credentialUrlParams } from './request-credentials'
import type { Pair, RequestSpec } from './request-spec'

export const RESPONSE_REDACTED = 'REDACTED'

function addValue(out: Set<string>, value: string | undefined): void {
  const candidate = value?.trim()
  if (!candidate || candidate === RESPONSE_REDACTED || hasSecretTokens(candidate)) return
  out.add(candidate)
  try {
    const encoded = encodeURIComponent(candidate)
    if (encoded !== candidate) out.add(encoded)
  } catch {
    // A credential is still scrubbed in its literal form when it cannot be URI encoded.
  }
}

function addHeaderFragments(out: Set<string>, header: Pair): void {
  addValue(out, header.value)
  const name = header.name.trim().toLowerCase()
  if (name === 'authorization' || name === 'proxy-authorization') {
    addValue(out, header.value.trim().split(/\s+/, 2)[1])
  }
  if (name === 'cookie') {
    for (const part of header.value.split(';')) {
      addValue(out, part.trim())
      const equals = part.indexOf('=')
      if (equals >= 0) addValue(out, part.slice(equals + 1))
    }
  }
}

/**
 * Credential values actually present on the signed wire request. Header/query names provide the
 * security boundary; auth fields cover an API key whose custom name is not in the conventional
 * lists. Values are sorted longest-first so a compound Authorization value is masked atomically.
 */
export function requestCredentialValues(
  spec: RequestSpec,
  signedUrl: URL | string,
  signedHeaders: readonly Pair[],
  environmentSecretValues: readonly string[] = [],
): string[] {
  const out = new Set<string>()
  for (const value of environmentSecretValues) addValue(out, value)
  for (const header of credentialHeaders(signedHeaders)) addHeaderFragments(out, header)
  for (const pair of credentialQueryPairs(spec.query)) addValue(out, pair.value)
  for (const pair of credentialUrlParams(signedUrl.toString())) {
    addValue(out, pair.value)
    try {
      addValue(out, decodeURIComponent(pair.value.replace(/\+/g, ' ')))
    } catch {
      // Keep the raw query fragment when percent-decoding is malformed.
    }
  }
  try {
    const parsed = signedUrl instanceof URL ? signedUrl : new URL(signedUrl)
    addValue(out, decodeURIComponent(parsed.username))
    addValue(out, decodeURIComponent(parsed.password))
  } catch {
    // Invalid URLs are still scrubbed through named query values and declared auth fields.
  }
  switch (spec.auth.type) {
    case 'basic':
      addValue(out, spec.auth.password)
      break
    case 'bearer':
      addValue(out, spec.auth.token)
      break
    case 'apikey':
      addValue(out, spec.auth.value)
      break
    case 'none':
      break
  }
  return [...out].sort((a, b) => b.length - a.length)
}

/** Recover token substitutions by comparing a safe `${secret:KEY}` template with its wire value. */
export function resolvedSecretValues(template: string, resolved: string): string[] {
  const token = /\$\{secret:[A-Za-z0-9_.-]+\}/g
  const matches = [...template.matchAll(token)]
  if (matches.length === 0 || template === resolved) return []
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let cursor = 0
  let pattern = '^'
  for (const match of matches) {
    const at = match.index ?? cursor
    pattern += escape(template.slice(cursor, at)) + '([\\s\\S]*?)'
    cursor = at + match[0].length
  }
  pattern += escape(template.slice(cursor)) + '$'
  const captured = new RegExp(pattern).exec(resolved)
  if (!captured) return [resolved]
  return captured.slice(1).filter(Boolean)
}

export function redactTextSecrets(text: string, values: readonly string[]): string {
  let out = text
  for (const value of values) out = out.split(value).join(RESPONSE_REDACTED)
  return out
}

export interface RedactableResponse {
  url: string
  headers: Record<string, string>
  body: string
  hops: Array<{ url: string; status: number; elapsedMs: number }>
  cookies?: ResponseCookie[]
}

/** A copy safe for UI, history and model output. The raw response never leaves sendRequest. */
export function redactResponseSecrets<T extends RedactableResponse>(
  response: T,
  values: readonly string[],
): T {
  if (values.length === 0) return response
  return {
    ...response,
    url: redactTextSecrets(response.url, values),
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [
        name,
        redactTextSecrets(value, values),
      ]),
    ),
    body: redactTextSecrets(response.body, values),
    hops: response.hops.map((hop) => ({
      ...hop,
      url: redactTextSecrets(hop.url, values),
    })),
    ...(response.cookies
      ? {
          cookies: response.cookies.map((cookie) => ({
            ...cookie,
            value: redactTextSecrets(cookie.value, values),
          })),
        }
      : {}),
  }
}
