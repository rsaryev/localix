/**
 * Claude Code hooks as the chat runtime names them: the events it accepts and never fires (the
 * names are the kit's `HookEvent`s; the kit's session runs the hooks, `features/plugins/kit/hooks`),
 * and the cap on hook text appended to a tool result.
 *
 * Pure type + constant module — no chat/UI imports; the event names are the kit's types.
 */

import type { HookEvent } from '@rsaryev/llx-plugin'

/**
 * Claude Code events this host accepts in a hooks file but never fires, each with the reason a
 * plugin author is shown. Only events with no lifecycle point here belong in this list.
 */
export const CC_INERT_HOOK_EVENTS = {
  Setup:
    'it fires only for the Claude Code CLI flags --init-only, -p --init and -p --maintenance; Localix starts no such one-time init or maintenance run (its first-run dialog is a UI tip with no session), so use SessionStart for per-session setup',
  DirectoryAdded:
    'a Localix session has exactly one working directory, its project folder: there is no /add-dir or register_repo_root, "Add folder" opens another project, and moving a session to another project fires CwdChanged',
  WorktreeRemove:
    "it fires only when a worktree session ends, ExitWorktree runs, claude remote-control cleans up or a background session is deleted, and Localix has none of these; a workflow agent's worktree that a WorktreeCreate hook made is kept when the agent finishes, as in Claude Code, so remove it yourself",
} as const satisfies Partial<Record<HookEvent, string>>
export type CcInertHookEvent = keyof typeof CC_INERT_HOOK_EVENTS

export function isInertCcHookEvent(value: string): value is CcInertHookEvent {
  return Object.hasOwn(CC_INERT_HOOK_EVENTS, value)
}
