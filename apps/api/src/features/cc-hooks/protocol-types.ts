import type { CcHookEvent } from './contracts'
import type { CcAddedHookInput } from './protocol-event-inputs'

// ---------------------------------------------------------------------------
// Command-hook JSON protocol
// ---------------------------------------------------------------------------

/** The events whose documented input carries `permission_mode` (hooks.md, each event's example). */
export const PERMISSION_MODE_EVENTS: ReadonlySet<CcHookEvent> = new Set<CcHookEvent>([
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PermissionDenied',
  'SubagentStop',
  'TaskCompleted',
  'Stop',
  'TeammateIdle',
])

/** Common fields every hook receives as JSON on stdin. */
export interface CcHookInputBase {
  session_id: string
  /** The session's transcript file, or empty where the host keeps none. */
  transcript_path: string
  cwd: string
  /** Claude Code's spelling of the session's mode, on the events whose examples carry it. */
  permission_mode?: string
  /** The user prompt being answered (absent before the first user input). */
  prompt_id?: string
  /** The effort level in effect. */
  effort?: { level: string }
  hook_event_name: CcHookEvent
  /** The subagent the hook fires in (a delegated child's id and type). */
  agent_id?: string
  agent_type?: string
}

export interface CcSessionStartInput extends CcHookInputBase {
  hook_event_name: 'SessionStart'
  /**
   * `startup` | `resume` | `clear` | `compact`. We fire `startup` on a session's
   * first run, `clear` after `/clear`, and `compact` after a context checkpoint
   * (both re-fire on the NEXT run so the injected context lands in a model turn).
   */
  source: string
  /** The session's model, when known. */
  model?: string
}
export interface CcUserPromptSubmitInput extends CcHookInputBase {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}
export interface CcPreToolUseInput extends CcHookInputBase {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id?: string
}
export interface CcPostToolUseInput extends CcHookInputBase {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id?: string
  /** How long the tool ran, in milliseconds. */
  duration_ms?: number
}
export interface CcPostToolUseFailureInput extends CcHookInputBase {
  hook_event_name: 'PostToolUseFailure'
  tool_name: string
  tool_input: unknown
  /** What the tool threw. */
  error: string
  /** True when the call was cut short by a cancellation, not a failure of its own. */
  is_interrupt: boolean
  tool_use_id?: string
  duration_ms?: number
}
export interface CcStopInput extends CcHookInputBase {
  hook_event_name: 'Stop'
  /** True when this Stop fires on a run that is ALREADY a Stop-hook-forced
   *  continuation — a hook should check it and not block again (CC loop protection). */
  stop_hook_active: boolean
  /** The turn's final answer text. */
  last_assistant_message: string
  /** Claude Code's running background tasks and session crons: none are reported here. */
  background_tasks: unknown[]
  session_crons: unknown[]
}
export interface CcSessionEndInput extends CcHookInputBase {
  hook_event_name: 'SessionEnd'
  /** `clear` | `resume` | `logout` | `prompt_input_exit` | `bypass_permissions_disabled` | `other`. */
  reason: string
}
export interface CcSubagentStartInput extends CcHookInputBase {
  hook_event_name: 'SubagentStart'
  agent_id: string
  /** Subagent type name (`general-purpose`, a plugin agent `plugin:name`, …). */
  agent_type: string
}
export interface CcSubagentStopInput extends CcHookInputBase {
  hook_event_name: 'SubagentStop'
  agent_id: string
  agent_type: string
  /** The subagent's final response text (when it produced one). */
  last_assistant_message?: string
  /** True when this SubagentStop fires on a run already forced by a prior block. */
  stop_hook_active: boolean
  /** The subagent's own transcript (the host's `transcript_path` for it). */
  agent_transcript_path: string
  /** The parent session's running work and scheduled loops, as on Stop. */
  background_tasks: unknown[]
  session_crons: unknown[]
}
export interface CcPreCompactInput extends CcHookInputBase {
  hook_event_name: 'PreCompact'
  /** Claude Code's `manual` (its `/compact`) | `auto` (size-triggered — a checkpoint, here). */
  trigger: string
  /** Claude Code's `/compact` argument; `null` from this host, which has no such command. */
  custom_instructions: string | null
}
export interface CcNotificationInput extends CcHookInputBase {
  hook_event_name: 'Notification'
  message: string
  title?: string
  notification_type?: string
}

export type CcHookInput =
  | CcSessionStartInput
  | CcUserPromptSubmitInput
  | CcPreToolUseInput
  | CcPostToolUseInput
  | CcPostToolUseFailureInput
  | CcStopInput
  | CcSessionEndInput
  | CcSubagentStartInput
  | CcSubagentStopInput
  | CcPreCompactInput
  | CcNotificationInput
  | CcAddedHookInput

/**
 * The normalized outcome of ONE command-hook invocation, folded from its exit
 * code + stdout JSON (or plain text) + stderr. All fields optional — a silent
 * exit-0 hook produces `{}`.
 */
export interface CcHookOutcome {
  /** True when the hook exited 2 (blocking error). `blockReason` = its stderr. */
  blocked?: boolean
  blockReason?: string
  /** `continue:false` — stop all processing; `stopReason` shown to the user. */
  continue?: boolean
  stopReason?: string
  /** `systemMessage` — a warning surfaced to the user. */
  systemMessage?: string
  /** Top-level `decision:"block"` + `reason` (PostToolUse / Stop / UserPromptSubmit). */
  decision?: 'block'
  reason?: string
  /** `hookSpecificOutput.additionalContext`, or plain-text stdout for context events. */
  additionalContext?: string
  /**
   * PostToolUse `hookSpecificOutput.updatedToolOutput`, as the hook wrote it: a string or the
   * tool's own output shape (`{stdout, stderr, …}` for Bash). `tool-output-replacement.ts` reads it.
   */
  updatedToolOutput?: unknown
  /** PostToolUse `hookSpecificOutput.updatedMCPToolOutput`: an MCP tool's output, unvalidated. */
  updatedMCPToolOutput?: unknown
  /** SessionStart / UserPromptSubmit `hookSpecificOutput.sessionTitle`: names the session. */
  sessionTitle?: string
  /** PreToolUse `hookSpecificOutput.permissionDecision` + reason. */
  permissionDecision?: 'allow' | 'deny' | 'ask'
  permissionDecisionReason?: string
  /** PreToolUse `updatedInput` / `hookSpecificOutput.updatedInput`. */
  updatedInput?: unknown
  /** PermissionRequest `hookSpecificOutput.decision`. */
  permissionRequest?: {
    behavior: 'allow' | 'deny'
    updatedInput?: unknown
    message?: string
    interrupt?: boolean
  }
  /** PermissionDenied `hookSpecificOutput.retry`. */
  retry?: boolean
  /** Elicitation / ElicitationResult `hookSpecificOutput.action` (+ `content`). */
  elicitation?: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }
  /** MessageDisplay `hookSpecificOutput.displayContent`: what is shown in place of the text. */
  displayContent?: string
  /**
   * WorktreeCreate: the folder the hook made, as it returned it — a command's last non-empty stdout
   * line, an MCP tool's text read the same way, an http body's `hookSpecificOutput.worktreePath`.
   */
  worktreePath?: string
  /** CwdChanged / FileChanged `watchPaths` (top level or in `hookSpecificOutput`). */
  watchPaths?: string[]
  /**
   * The hook did not finish its work: a timeout, an exit code other than 0/2, a non-2xx HTTP
   * response, a failed MCP call. Most events ignore it; PreModelSwitch reads a timeout as a block.
   */
  failed?: 'timeout' | 'error'
  /** What a failed hook wrote to stderr, for the error an `onFailure: "block"` hook reports. */
  failureDetail?: string
}
