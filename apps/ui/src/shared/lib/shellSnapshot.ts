/**
 * The last frame the workbench was known to be in, kept locally so the next launch can
 * paint it before the network has said anything.
 *
 * WHY THIS EXISTS. Startup was three visible waves. The shell painted with an EMPTY
 * sidebar and an EMPTY activity rail, because both are gated on data that only exists
 * after a round trip: the session roster (~0.3s) and the capability snapshot (~1.2s, it
 * pays for plugin discovery). Measured on a packaged boot, the rail therefore sat blank
 * for over a second and then filled with icons — not a flicker, a structural pop-in, and
 * the thing that reads as "the app is still assembling itself".
 *
 * No amount of request tuning fixes that, because the frame cannot be correct until a
 * server answers. What fixes it is not asking: the shell of a workbench barely changes
 * between launches, so the previous answer is very nearly always the right frame. Write
 * it down, paint it synchronously, and let the network CONFIRM rather than reveal.
 *
 * WHAT IS AND IS NOT IN HERE. Structure and labels only: the session roster and the
 * capability set. No message bodies, no file contents, no anything a stale copy could
 * mislead about — those keep loading exactly as they do today. A stale roster costs at
 * most one title that changes a beat later; a stale transcript would be a lie.
 *
 * That promise is ENFORCED, not assumed: the store's sessions are merged bodies, and a body
 * recorded here was painted as loaded on the next launch, never refetched, and written back —
 * a plan approved hours earlier kept asking for approval. Both the write
 * (`store.ts`) and the read (`restoreShellFrame.ts`) pass every session through
 * `uiSessionSummary` (`shared/api/session-summary.ts`).
 *
 * SCOPE. A snapshot belongs to the project it was taken in. Restoring project A's rail
 * into project B would be worse than an empty one, so the scope is part of the record and
 * a mismatch is simply ignored.
 */

import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

const SHELL_SNAPSHOT_KEY = 'localix_shell_snapshot'

/**
 * Bumped whenever a stored field changes meaning. An older record is dropped rather than
 * migrated: the cost of being wrong is a wrong first frame, and the cost of dropping it is
 * one launch that looks like today's.
 */
const SHELL_SNAPSHOT_SCHEMA = 2

/**
 * A cap, not a target. The roster is the one unbounded part of the record, and a user with
 * thousands of sessions should not spend their startup parsing JSON they cannot see. The
 * sidebar is ordered by recency, so the newest are the ones worth restoring.
 */
export const SHELL_SNAPSHOT_SESSION_LIMIT = 200

export interface ShellCapabilitiesFrame {
  revision: number
  enabledNames: string[]
  plugins: unknown[]
  views: unknown[]
  tools: unknown
}

export interface ShellSnapshot<TSession = unknown> {
  v: number
  /** The project the frame was taken in; `null` only in a record written before scopes
   *  were always projects, which no longer matches any scope and so is never restored. */
  projectId: string | null
  sessions: TSession[]
  capabilities: ShellCapabilitiesFrame | null
}

function readRaw(): ShellSnapshot | null {
  const stored = loadJSON<ShellSnapshot>(SHELL_SNAPSHOT_KEY)
  if (!stored || stored.v !== SHELL_SNAPSHOT_SCHEMA) return null
  if (!Array.isArray(stored.sessions)) return null
  return stored
}

/**
 * The stored frame for this scope, or null when there is none, it is from another scope,
 * or it was written by an older schema. Never throws: an unreadable snapshot has to
 * degrade to today's behaviour, not to a broken launch.
 */
export function readShellSnapshot<TSession>(
  projectId: string | null,
): ShellSnapshot<TSession> | null {
  const stored = readRaw()
  if (!stored || stored.projectId !== projectId) return null
  return stored as ShellSnapshot<TSession>
}

function write(next: ShellSnapshot): void {
  saveJSON(SHELL_SNAPSHOT_KEY, next)
}

/**
 * Record the roster. Replaces the whole record when the scope changed, so the two halves
 * can never describe different projects.
 */
export function rememberShellSessions(
  projectId: string | null,
  sessions: readonly unknown[],
): void {
  const stored = readRaw()
  const carried = stored?.projectId === projectId ? stored : null
  write({
    v: SHELL_SNAPSHOT_SCHEMA,
    projectId,
    sessions: sessions.slice(0, SHELL_SNAPSHOT_SESSION_LIMIT),
    capabilities: carried?.capabilities ?? null,
  })
}

/** Record the capability set. Same scope rule as {@link rememberShellSessions}. */
export function rememberShellCapabilities(
  projectId: string | null,
  capabilities: ShellCapabilitiesFrame,
): void {
  const stored = readRaw()
  const carried = stored?.projectId === projectId ? stored : null
  write({
    v: SHELL_SNAPSHOT_SCHEMA,
    projectId,
    sessions: carried?.sessions ?? [],
    capabilities,
  })
}

/** Forget everything. For sign-out-shaped transitions and for tests. */
export function forgetShellSnapshot(): void {
  saveJSON(SHELL_SNAPSHOT_KEY, null)
}
