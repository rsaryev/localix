/**
 * Process-wide "a chat's plugin session moved" announcement.
 *
 * A Claude Code plugin's `always` monitor starts with its session, and an `on-skill-invoke` one the
 * first time its skill runs there. The chat's kit session keeps that ledger itself; what it needs
 * from the runtime is to be asked again when the session opened or ran a turn, and after it ran a
 * skill (the skill tool's `get`, a typed `/skill`). Those places fire here; the composition root
 * registers the one listener (the plugin monitor host), so neither path needs a new port.
 *
 * A documented command (architecture rule C5): the reaction is in-memory (a process started for
 * the chat), nothing is persisted. Best-effort: a listener that fails never fails a run or a skill.
 */

export interface SessionActivity {
  userId: string
  /** The chat's root session: the monitors' lines go there, and stop when it ends. */
  chatId: string
  /** The session that moved: the chat's own, or a sub-agent's in it. */
  sessionId: string
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
