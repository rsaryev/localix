/**
 * Ownership rule for externally-triggered tool actions (HTTP/WS `interact`:
 * background `send_input`/`kill`). The action registry is process-wide, so a
 * background job records its owner; an interact from a *different* user must be
 * refused (cross-tenant action injection — see security finding iter33/37).
 *
 * Returns true when the action may proceed:
 *  - `callerUserId` omitted  → trusted internal caller (jobs tool, shutdown) — allow
 *  - `owner` unknown         → not an owned background job — allow (fall through to
 *                              the normal action lookup)
 *  - owner === caller        → same user — allow
 * Only a known owner that differs from a provided caller is blocked. This is a
 * no-op in the default single-user deployment (owner always equals caller).
 */
export function isInteractAllowedForOwner(
  owner: string | undefined,
  callerUserId: string | undefined,
): boolean {
  if (!callerUserId) return true
  if (!owner) return true
  return owner === callerUserId
}
