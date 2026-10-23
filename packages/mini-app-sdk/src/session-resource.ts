import { localixResourceUri, parseLocalixUri } from './navigation'

/**
 * The address of a resource that exists once per chat — a game's board, a chat's task board:
 * `localix://resource/<provider>/<name>` for "the one in the chat this link is followed from"
 * (the host resolves it against the caller's own session, never the chat on screen), and
 * `…/<name>/<session>` for one named chat's.
 *
 * Every session-bound plugin wrote this pair itself, as a string prefix and a `startsWith(… + '/')`
 * split — four identical copies, each one a hand-rolled parser beside the one grammar that already
 * rejects dot segments, empty segments and overlong ids. Building and reading it through
 * {@link localixResourceUri} and {@link parseLocalixUri} keeps an opaque session id (a `/`, a `%`)
 * one segment by construction.
 */
export function sessionResourceAddress(provider: string, name: string) {
  const uri = localixResourceUri(provider, [name])
  return {
    /** The resource of the chat the link is followed from. */
    uri,
    /** One chat's resource. */
    forSession: (sessionId: string) => localixResourceUri(provider, [name, sessionId]),
    /**
     * The session a URI names; `null` for the bare {@link uri}; `undefined` for any other URI.
     * An arrow property, not a method: callers re-export it detached (`sessionOfGameUri =
     * game.sessionOf`), and a method would read as one that loses its `this`.
     */
    sessionOf: (candidate: string): string | null | undefined => {
      const parsed = parseLocalixUri(candidate)
      if (parsed?.primitive !== 'resource' || parsed.query.size > 0) return undefined
      const [owner, resource, sessionId, ...rest] = parsed.breadcrumbs
      if (owner !== provider || resource !== name || rest.length > 0) return undefined
      return sessionId ?? null
    },
  }
}
