/**
 * Process-wide "a chat ran a turn" announcement, the sibling of `skill-invocations.ts`.
 *
 * A Claude Code plugin's `always` monitor starts with each session, in its working directory, and
 * speaks to it. The chat runtime announces each run here; the composition root registers the one
 * listener (the plugin monitor host), so the run path needs no new port.
 *
 * A documented command (architecture rule C5): the reaction is in-memory (a process started and
 * armed for the chat), nothing is persisted. Best-effort: a listener that fails never fails a run.
 */

export interface SessionActivity {
  userId: string
  /** The chat's root session: the monitor's lines go there. */
  sessionId: string
  /** The chat's working directory. */
  cwd?: string
}

export type SessionActivityListener = (activity: SessionActivity) => void | Promise<unknown>

let listener: SessionActivityListener | null = null

export function setSessionActivityListener(next: SessionActivityListener | null): void {
  listener = next
}

export function announceSessionActive(activity: SessionActivity): void {
  if (!listener) return
  try {
    void Promise.resolve(listener(activity)).catch(() => {})
  } catch {
    // best-effort only
  }
}
