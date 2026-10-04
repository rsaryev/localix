/**
 * "Reopen the workspace I left" — the launch-time decision, as a pure function.
 *
 * THE BUG THIS EXISTS TO KILL. The restore used to be a one-shot effect that latched
 * itself on its first post-hydration pass and validated the remembered project against
 * `store.projects`. But `restoreShellFrame()` runs BEFORE `createRoot` and flips
 * `_hasHydrated` synchronously, while `projects` only arrives on its own request a beat
 * later. So the very first pass — the only pass the latch allowed — always read an EMPTY
 * projects roster, judged the remembered project non-existent, and fell through to the
 * neutral home, which minted a fresh chat. The sidebar had already painted the project's
 * chats from the shell snapshot, so the user watched their workspace appear and then get
 * replaced by an empty new session. Every launch. Deterministically.
 *
 * The fix is not a longer latch, it is making "I cannot decide yet" a first-class answer.
 * `wait` says the evidence hasn't landed; the caller holds the home landing (minting a
 * draft there would both show the wrong frame AND overwrite the record we are restoring
 * from) and asks again when the roster changes.
 *
 * Pure on purpose: the whole decision table — including the ones that are awkward to
 * reproduce in a browser, like a project deleted between launches — is unit tested without
 * a DOM, a router, or storage. The effect in `useUrlStoreSync` only applies the verdict.
 */

import type { LastWorkspace } from './persistence'

/**
 * How long to hold the home landing waiting for the projects roster.
 *
 * A ceiling, not a delay: the roster normally lands in well under a second and the restore
 * fires the moment it does. This only bounds the pathological case — a sidecar that never
 * answers — so a broken backend degrades to the neutral landing instead of an app that
 * never shows a chat at all.
 */
export const LAUNCH_RESTORE_WAIT_MS = 4_000

export type LaunchRestoreDecision =
  /** The projects roster hasn't arrived; hold the home landing and re-decide. */
  | { kind: 'wait' }
  /**
   * Reopen this scope. `sessionId === null` means navigate to the BARE scope and let
   * `selectProject` resolve the chat against the live roster.
   */
  | { kind: 'restore'; projectId: string; sessionId: string | null }
  /**
   * Fall through to the neutral landing. `forget` marks a confirmed-dead record; `keep` marks
   * one that could NOT be checked (the wait ran out), which the landing must leave untouched.
   */
  | { kind: 'home'; forget: boolean; keep: boolean }

export interface LaunchRestoreInput {
  /** The persisted pair, or `null` when this is a first launch. */
  remembered: LastWorkspace | null
  projects: readonly { id: string }[]
  /** Whether `projects` is an ANSWER or merely an empty initial value. */
  projectsLoaded: boolean
  /** The full session roster (`allSessions`) — present from the first frame. */
  sessions: readonly { id: string; projectId: string }[]
  /** {@link LAUNCH_RESTORE_WAIT_MS} is spent: decide with the evidence at hand. */
  waitExpired: boolean
}

export function resolveLaunchRestore(input: LaunchRestoreInput): LaunchRestoreDecision {
  const { remembered } = input
  if (!remembered) return { kind: 'home', forget: false, keep: false }
  const { projectId } = remembered

  // A project scope can only be validated against the projects roster, and that roster
  // hydrates on its own request — later than the session roster the shell frame restores
  // synchronously. Deciding before it lands is precisely the original defect.
  //
  // When the wait runs out (a slow boot: a migration after an update), the landing's own
  // draft would otherwise OVERWRITE this record through `rememberActiveSession`, and the
  // next launch would forget where the person was. `keep` tells the caller to hold it.
  if (!input.projectsLoaded) {
    return input.waitExpired ? { kind: 'home', forget: false, keep: true } : { kind: 'wait' }
  }
  if (!input.projects.some((project) => project.id === projectId)) {
    // Confirmed gone (the roster ANSWERED and does not contain it) — deleted here, or in
    // another window, or on another machine. Drop the record so it stops costing a wait
    // on every future launch.
    return { kind: 'home', forget: true, keep: false }
  }

  // Restore the BARE project scope — `sessionId: null` is deliberate, not a gap. A project
  // route resolves its own chat: `selectProject` picks the scope's remembered session when
  // the live roster still has it, else the first root chat, and the normalization redirect
  // stamps the winner into the URL. Reusing that validated resolution is what guarantees a
  // session deleted since the last launch can never reach the address bar.
  return { kind: 'restore', projectId, sessionId: null }
}
