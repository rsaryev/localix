/**
 * How the sidebar ORDERS and GROUPS a flat list of requests. Pure — no React, no store — so the
 * ordering is a value the panel derives, not state anyone has to persist. We keep ZERO backend for
 * this: there are no real folders and no saved sort order per workspace, and we get the same
 * affordance for free by deriving both from fields `RequestInfo` already carries.
 *
 * The sort modes are the three that earn their place — a request has no separate "created" identity
 * worth a fourth mode here — plus derived grouping (by host or method) in place of folders.
 */

import type { RequestInfo } from '../../backend/contracts'

/** The sort orders the header Select offers. `name` is the default because a list you scan by eye
 *  is a list sorted by the thing you read first. */
export type SortMode = 'name' | 'method' | 'recent'

/** The grouping the sidebar can overlay on top of the sort. `none` is a single flat list; the
 *  others bucket by a field already on the spec, so no folder ever has to be stored. */
export type GroupMode = 'folder' | 'none' | 'host' | 'method'

/** The bucket a templated (`{{ base_url }}`) or unparseable url falls into. It is NOT an error —
 *  a request whose host is an environment variable is the normal case for a well-templated
 *  collection — so it reads as its own honest group rather than getting mis-sorted under "".
 *  Exported so the integrator can match on it to style/pin the bucket if it wants. */
export const TEMPLATED_HOST_BUCKET = 'Templated / no host'

/** `{{ … }}` anywhere in the url means the host isn't known until an environment renders it. We
 *  detect rather than try to parse, because `new URL('{{base_url}}/x')` throws and a request that
 *  hasn't picked a host yet is not the same as one with a broken url. */
const TEMPLATED_RE = /\{\{.*?\}\}/

/**
 * Order a copy of `requests` by `mode`. Never mutates its input — the caller holds the list from
 * the store and a sort must not reorder that in place.
 *
 * STABLE and TOTAL. `localeCompare` and the numeric `updatedAt` compare are proper orderings, but
 * ties (two GETs, two requests saved in the same millisecond) must not shuffle between renders, so
 * every mode falls back to `name` and finally to a stable index. `Array.prototype.sort` is
 * spec-guaranteed stable, but we still tie-break explicitly: the fallback keeps the order
 * meaningful (alphabetical within a method group) rather than merely reproducible.
 */
export function sortRequests(
  requests: readonly RequestInfo[],
  mode: SortMode = 'name',
): RequestInfo[] {
  const copy = requests.slice()
  switch (mode) {
    case 'method':
      // Group visually by verb, then alphabetise within each verb so a screenful of GETs is still
      // scannable. Method compare is a plain string compare — HTTP_METHODS is a small fixed set and
      // its alphabetical order (DELETE, GET, HEAD, …) is as good as any for a heading list.
      return copy.sort((a, b) => a.spec.method.localeCompare(b.spec.method) || byName(a, b))
    case 'recent':
      // Most-recently-touched first: the request you just ran or edited floats to the top, which is
      // where you'll look for it next. Descending on `updatedAt`, name as the tie-break.
      return copy.sort((a, b) => b.updatedAt - a.updatedAt || byName(a, b))
    case 'name':
      return copy.sort(byName)
  }
}

/** The one name comparison every mode tie-breaks on, so "equal by X" still reads alphabetically. */
function byName(a: RequestInfo, b: RequestInfo): number {
  return a.name.localeCompare(b.name)
}

/**
 * The heading a request belongs under for a given grouping. Pure and total — every request maps to
 * exactly one non-empty string, so the caller can `Map`-bucket without a null branch.
 *
 * - `none`   → one bucket. The empty string is a fine key for "no grouping": there is only ever the
 *              one, so its label is never shown.
 * - `folder` → NOT a bucket at all: the folders live in the request's own name, so that mode
 *              renders a real tree (`ui/RequestTree.tsx`) and never reaches this function. It
 *              answers with the flat bucket so the type stays total, and a caller that forgets
 *              the tree gets one readable list rather than a crash.
 * - `host`   → `new URL(spec.url).host`, with templated/unparseable urls collected under
 *              {@link TEMPLATED_HOST_BUCKET}. `host` (not `hostname`) keeps a non-default port
 *              visible, because `api.example.com:8443` and `:443` are different endpoints to group.
 * - `method` → the verb verbatim. Already a small closed vocabulary; no bucket needed.
 */
export function groupKey(request: RequestInfo, mode: GroupMode): string {
  switch (mode) {
    case 'method':
      return request.spec.method
    case 'host': {
      const url = request.spec.url
      if (TEMPLATED_RE.test(url)) return TEMPLATED_HOST_BUCKET
      try {
        return new URL(url).host || TEMPLATED_HOST_BUCKET
      } catch {
        // A relative url (`/users`), a bare host, or anything `new URL` rejects has no host we can
        // name — same honest bucket as a templated one rather than an invented heading.
        return TEMPLATED_HOST_BUCKET
      }
    }
    case 'none':
    case 'folder':
      return ''
  }
}
