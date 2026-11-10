/**
 * Claude Code hooks as the chat runtime names them: the events it fires (the kit's session runs
 * them, `features/plugins/kit/hooks`), the ones it accepts and never fires, and the cap on hook
 * text appended to a tool result.
 *
 * Pure type + constant module — no chat/UI imports.
 */

/** The lifecycle events this host dispatches hooks for. */
export const CC_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  // A typed slash command or plugin command expanding into its prompt.
  'UserPromptExpansion',
  'PreToolUse',
  // A tool approval card is about to wait on the person; a hook may answer it first.
  'PermissionRequest',
  // A permission rule or the permission mode refused a call without asking anyone.
  'PermissionDenied',
  'PostToolUse',
  // A tool that threw: in place of PostToolUse, as in Claude Code.
  'PostToolUseFailure',
  // Every tool call of one model response resolved, before the next model request.
  'PostToolBatch',
  'Stop',
  // The turn ended on a provider error instead of an answer.
  'StopFailure',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  // The task board (the tool with the `task-board` role) gained a card, or is about to close one.
  'TaskCreated',
  'TaskCompleted',
  'PreCompact',
  // A context checkpoint (this host's compaction) was taken.
  'PostCompact',
  // Notification fires (observer-only) when a HITL request surfaces.
  'Notification',
  // A CLAUDE.md / AGENTS.md / rules file entered the prompt.
  'InstructionsLoaded',
  // The agent's `Configure` tool, or a skill saved from Localix, changed configuration.
  'ConfigChange',
  // The session moved to a project with another working directory.
  'CwdChanged',
  // A file named by a FileChanged matcher, or by a hook's `watchPaths`, changed on disk.
  'FileChanged',
  // The session's model route changed on request (`/model`, the model picker).
  'PreModelSwitch',
  'PostModelSwitch',
  // An MCP server asks the person for input mid tool call, and the answer before it goes back.
  'Elicitation',
  'ElicitationResult',
  // The turn's text is settled; a hook may change only what is shown.
  'MessageDisplay',
  // A workflow agent with isolation: 'worktree' needs its folder: the hook makes it in git's place.
  'WorktreeCreate',
] as const
export type CcHookEvent = (typeof CC_HOOK_EVENTS)[number]

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
} as const satisfies Record<string, string>
export type CcInertHookEvent = keyof typeof CC_INERT_HOOK_EVENTS

export function isInertCcHookEvent(value: string): value is CcInertHookEvent {
  return Object.hasOwn(CC_INERT_HOOK_EVENTS, value)
}

/**
 * Max chars of hook context appended to a tool result: Claude Code's 10,000-character cap per
 * string, for the joined notes of several hooks.
 */
export const CC_POST_APPEND_CAP_BYTES = 4 * 10_000
