/**
 * Process-wide "a skill ran in this chat" announcement.
 *
 * A skill runs in two places that know nothing of each other's hosts: the `/<skill>` command
 * handler and the skill tool's `get` (the agent loading a skill). Something outside chat may need
 * to react — a plugin monitor declared `on-skill-invoke:<skill>` starts then, as in Claude Code.
 * Like `skill-usage-recorder.ts`, the composition root registers the one listener, and both
 * places fire into it without threading a new port through the tool registry.
 *
 * A documented command (architecture rule C5): the reaction is in-memory (a process started
 * and armed for the chat), nothing is persisted, so there is no notice to record. Best-effort:
 * a listener that throws or rejects never fails the skill.
 */

export interface SkillInvocation {
  userId: string
  /** The chat the skill ran in — its root, so a skill a sub-agent loads reaches the chat. */
  sessionId: string
  skillName: string
  /** The plugin that ships the skill; absent for a personal or project skill. */
  pluginName?: string
  /** The chat's working directory, when the caller knows it. */
  cwd?: string
}

export type SkillInvocationListener = (invocation: SkillInvocation) => void | Promise<unknown>

let listener: SkillInvocationListener | null = null

export function setSkillInvocationListener(next: SkillInvocationListener | null): void {
  listener = next
}

export function announceSkillInvoked(invocation: SkillInvocation): void {
  if (!listener) return
  try {
    void Promise.resolve(listener(invocation)).catch(() => {})
  } catch {
    // best-effort only
  }
}
