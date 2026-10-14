/**
 * The ONE place the raw `x-user-id` request header becomes a request identity.
 *
 * The identity is SELF-ASSERTED — there is no authentication; a request either names a
 * user or it doesn't. Because this is the single entry, it is the single place to fail
 * closed on a DEGENERATE header: a blank or whitespace-only `x-user-id:` value.
 *
 * WHY THIS EXISTS. The old expression was `c.req.header('x-user-id') ?? defaultUserId`.
 * `??` catches `undefined` but NOT `''`, so a client sending `x-user-id:` with an empty
 * value produced `userId=''`. Every "no caller" guard downstream is written `if (!userId)`
 * — most importantly the TRUSTED-INTERNAL path in `chat/runtime/interact-ownership.ts`,
 * taken by callers that pass NO user (the jobs tool, shutdown). An empty STRING is falsy,
 * so a blank request header impersonated that trusted-internal caller and BYPASSED
 * ownership on every owned action (background `send_input`/`kill`, HITL respond/dismiss,
 * preview-command). This class had already converged on that `!callerUserId` guard once;
 * fixing each downstream reader is whack-a-mole. Fix the CLASS at the boundary instead —
 * a *request* identity is never blank, so no downstream `if (!userId)` can mistake a
 * request for the internal caller (which stays `undefined`, never a request value).
 *
 * WHY DEFAULT AND NOT 401. The app is single-user and unauthenticated: an ABSENT header
 * already maps to the default user, and a blank header is semantically the same case ("I
 * named no user"). Mapping blank → the default user (a real, non-empty id) is safer than
 * either alternative — `''` masqueraded as internal-trusted, and a new 401 would add a
 * failure mode to every route to defend a boundary that does not yet exist. The resulting
 * identity is a concrete user, subject to the SAME ownership checks as anyone else.
 *
 * Trim before the emptiness test: `'   '` is as absent as `''`, and a real id never
 * carries surrounding whitespace, so normalizing it away can only help.
 */
export function resolveRequestUserId(rawHeader: string | undefined, defaultUserId: string): string {
  const trimmed = rawHeader?.trim()
  return trimmed ? trimmed : defaultUserId
}

/**
 * The part of a request's query that is safe to write to disk: its KEYS, sorted.
 *
 * The request log records `path`, which excludes the query, and that blind spot hid a
 * real defect — a capability snapshot read in the global scope and one read in a
 * project's scope log identically while returning materially different answers (git
 * a7f4989a3). Keys resolve it, because an unscoped read simply has no `projectId`.
 *
 * Values must never join them. This server's own OAuth callback is handed
 * `?code=&state=`, so logging values would put authorization codes in
 * `~/.localix/logs/api.log` — a log we already rotate rather than protect.
 */
export function requestQueryKeys(query: Record<string, string>): string {
  return Object.keys(query).sort().join(',')
}
