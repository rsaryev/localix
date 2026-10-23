/**
 * The on-disk file format for requests shared through the repo — and the rule that decides what is
 * allowed to be written there at all.
 *
 * ONE FILE PER REQUEST, for the whole point of putting requests in a repo: a change has to be
 * reviewable. One file per request means a
 * pull request says "Ada changed the staging timeout" as a three-line diff. One collection blob
 * means it says "collection.json changed" and a reviewer reads 2000 lines to find out what.
 *
 * THE SECURITY RULE THIS MODULE EXISTS FOR: git history is forever. A credential committed once is
 * committed permanently — a later commit deleting it changes nothing, and the only real remedy is
 * rotating the secret and rewriting history. So a literal credential is REFUSED here rather than
 * redacted: redacting would silently export a request that no longer works, and refusing tells the
 * user the one thing they need to do.
 *
 * A `${secret:KEY}` reference exports freely, and that is the whole argument for references made
 * concrete: a pointer is shareable BY CONSTRUCTION. The team gets the request; each member's vault
 * supplies their own key. That is the thing plaintext environments cannot do.
 */

import { hasSecretTokens } from '@localixai/mini-app-sdk/backend'
import {
  credentialHeaders,
  credentialQueryPairs,
  credentialUrlParams,
} from '../request-credentials'
import type { RequestSpec } from '../request-spec'
import { authSecret } from '../secrets'

/** Bumped only when an older file would be read WRONG, never for an additive field. */
export const REQUEST_FILE_VERSION = 1

export interface RequestFile {
  /** Identifies the format to the importer chain — a bare spec would be ambiguous with anything. */
  localixRestRequest: typeof REQUEST_FILE_VERSION
  name: string
  spec: RequestSpec
}

export function buildRequestFile(name: string, spec: RequestSpec): RequestFile {
  return { localixRestRequest: REQUEST_FILE_VERSION, name, spec }
}

/** Read a file back, or null when it is not one of ours. */
export function parseRequestFile(text: string): RequestFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const file = parsed as Partial<RequestFile>
  if (file.localixRestRequest !== REQUEST_FILE_VERSION) return null
  if (typeof file.name !== 'string' || !file.spec || typeof file.spec !== 'object') return null
  if (typeof file.spec.url !== 'string' || typeof file.spec.method !== 'string') return null
  return file as RequestFile
}

/**
 * Why `spec` must not be committed, or null when it is safe to write.
 *
 * TWO places, not one. The auth block is the obvious one. The other is `Authorization` / `Cookie` /
 * `Proxy-Authorization` HEADERS, and missing them was a real hole for fourteen iterations: this
 * function checked auth only, on the argument that "auth is the one place this mini app promises to
 * hold credentials" — while `import/har.ts` puts a logged-in session's `Authorization` and `Cookie`
 * straight into headers by design, and `import/curl.ts` leaves any auth scheme it cannot sign there
 * too. Import a HAR from a logged-in tab, export, commit, and the session cookie is in git history
 * forever: precisely the outcome this module's header says it exists to prevent.
 *
 * Still not a scanner. `X-Trace: abc123` is not checked, because whether it is a secret is a guess.
 * `Authorization`, `Cookie` and the API-key names in `CREDENTIAL_HEADERS` are not guesses — either an
 * HTTP spec or a documented vendor convention says the value IS a credential.
 */
export function gitSafetyProblem(name: string, spec: RequestSpec): string | null {
  // The QUERY STRING, first: it is the cheapest place for a credential to hide and the one this
  // function used to ignore entirely. `buildRequestFile` writes the whole spec, `url` and `query`
  // included, so `https://api.x/v1?api_key=sk-live-…` — typed by hand or carried in from a cURL /
  // HAR import — went straight into a file in the user's repository. That is the same outcome the
  // header check exists to prevent, on the other half of the request line.
  const leakyParams = [
    ...credentialUrlParams(spec.url).filter((p) => !hasSecretTokens(p.value)),
    ...credentialQueryPairs(spec.query).filter((p) => !hasSecretTokens(p.value)),
  ]
  if (leakyParams.length > 0) {
    const named = [...new Set(leakyParams.map((p) => `\`${p.name}\``))].join(' / ')
    return (
      `"${name}" carries a literal credential in its ${named} query parameter, so it was NOT exported — ` +
      'a file in the repo ends up in git history, where a credential stays readable forever even after ' +
      'a later commit removes it. Replace the value with a `${secret:KEY}` reference, which is safe to ' +
      'commit because it names a key rather than carrying one, or move it into the auth block.'
    )
  }

  const leakyHeaders = credentialHeaders(spec.headers).filter((h) => !hasSecretTokens(h.value))
  if (leakyHeaders.length > 0) {
    return (
      `"${name}" carries a literal credential in its ${leakyHeaders.map((h) => `\`${h.name}\``).join(' / ')} header, ` +
      'so it was NOT exported — a file in the repo ends up in git history, where a credential stays readable forever ' +
      'even after a later commit removes it. (A HAR import keeps a logged-in session this way.) Remove the header, or ' +
      'replace its value with a `${secret:KEY}` reference, which is safe to commit because it names a key rather than ' +
      'carrying one.'
    )
  }

  const value = authSecret(spec.auth)?.value
  if (typeof value !== 'string' || value === '') return null
  if (hasSecretTokens(value)) return null // a pointer, not a secret

  return (
    `"${name}" holds a literal ${spec.auth.type} credential, so it was NOT exported — a file in the repo ends up in git ` +
    'history, where a credential stays readable forever even after a later commit removes it. ' +
    'Move it into the vault first (re-import the request, or re-save it with a `${secret:KEY}` reference); ' +
    'a reference is safe to commit, because it names a key rather than carrying one.'
  )
}

/**
 * A request name → a filename. The name is user-supplied, so this is a path-traversal boundary as
 * much as a formatting one: a request called `../../.ssh/config` must not decide where we write.
 *
 * Lossy on purpose, and the collision that implies is handled by the caller refusing to overwrite
 * a file it did not just write — not by making this reversible.
 */
export function requestFileName(name: string): string {
  const slug = name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
  return `${slug || 'request'}.json`
}
