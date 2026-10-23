/**
 * PURE `localix://resource/api` URI grammar — the one source of truth for this mini app's resource
 * tree, shared by the resource provider, the search provider, the context provider AND THE UI.
 *
 * The only import is `@localixai/mini-app-sdk/navigation`, and that is deliberate: it is a leaf
 * module with no `node:` reach, exactly as trading's `uri.ts` imports it. The BARREL
 * (`@localixai/mini-app-sdk/backend`) must never be imported here — it re-exports
 * `createUserEntityStore`, which reaches `node:fs/promises`; `ui/register.tsx` imports this file
 * and is loaded EAGERLY at app boot, so a barrel import throws in the browser and the whole app
 * renders a black screen. Both typechecks pass. `vite build` passes. Only running it fails.
 *
 * Grammar (positional):
 *   localix://resource/api                 → the collection itself (every saved request)
 *   localix://resource/api/<name>          → one saved request
 *
 * Two levels, and the flatness below them is honest: a saved request has no sub-parts worth
 * referencing separately. The COLLECTION level is not decoration — it is what an agent hands
 * back after an import creates eight requests at once ("open the API client"), and what a user
 * `@`-mentions to put the whole roster in context instead of picking one request at a time.
 *
 * A saved name is user-supplied and may hold `/`, `#` or spaces, so it travels as ONE breadcrumb
 * segment (the builder percent-encodes it) — it must NEVER be split across segments. A literal
 * `.`/`..` segment is rejected outright: it can only be a crafted traversal, never a real name.
 */

import { localixResourceUri, parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

/**
 * The provider segment, spelled here because this file must stay off the backend barrel (see the
 * header). `uri.provider.test.ts` pins it to this mini app's provider id — a test can
 * import the SDK because a test is not the browser.
 */
const API_PROVIDER = 'api'

/** A node in the `localix://resource/api` tree — the union {@link parseRestUri} yields. */
export type RestUriNode =
  | { kind: 'collection' }
  | {
      kind: 'request'
      /** The saved request's name — decoded, i.e. exactly the store's id. */
      name: string
    }

/** `localix://resource/api` — every saved request, as one referenceable collection. */
export function buildCollectionUri(): string {
  return localixResourceUri(API_PROVIDER)
}

/** `localix://resource/api/github-user` for the saved request named `github-user`. */
export function buildRequestUri(name: string): string {
  return localixResourceUri(API_PROVIDER, [name])
}

/** Parse a `localix://resource/api` URI, or null when it is not ours / not well-formed. */
export function parseRestUri(uri: string): RestUriNode | null {
  const parsed = parseLocalixUri(uri)
  if (parsed?.primitive !== 'resource' || parsed.breadcrumbs[0] !== API_PROVIDER) return null
  const segments = parsed.breadcrumbs.slice(1)
  if (segments.length === 0) return { kind: 'collection' }
  // Below the collection the tree is flat: a second segment is not our grammar.
  if (segments.length !== 1) return null
  const name = segments[0]!
  // `parseLocalixUri` already decoded the segment; a traversal token can only be crafted.
  if (name === '' || name === '.' || name === '..') return null
  return { kind: 'request', name }
}
