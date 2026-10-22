import type { CcHookEvent } from './contracts'

// ---------------------------------------------------------------------------
// Command-hook JSON protocol
// ---------------------------------------------------------------------------

/** Common fields every hook receives as JSON on stdin. */
export interface CcHookInputBase {
  session_id: string
  /** We do not persist a transcript file — passed empty. */
  transcript_path: string
  cwd: string
  hook_event_name: CcHookEvent
}

export interface CcSessionStartInput extends CcHookInputBase {
  hook_event_name: 'SessionStart'
  /**
   * `startup` | `resume` | `clear` | `compact`. We fire `startup` on a session's
   * first run, `clear` after `/clear`, and `compact` after a context checkpoint
   * (both re-fire on the NEXT run so the injected context lands in a model turn).
   */
  source: string
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
}
export interface CcPostToolUseFailureInput extends CcHookInputBase {
  hook_event_name: 'PostToolUseFailure'
  tool_name: string
  tool_input: unknown
  /** What the tool threw. */
  error: string
  /** True when the call was cut short by a cancellation, not a failure of its own. */
  is_interrupt: boolean
}
export interface CcStopInput extends CcHookInputBase {
  hook_event_name: 'Stop'
  /** True when this Stop fires on a run that is ALREADY a Stop-hook-forced
   *  continuation — a hook should check it and not block again (CC loop protection). */
  stop_hook_active?: boolean
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
  stop_hook_active?: boolean
}
export interface CcPreCompactInput extends CcHookInputBase {
  hook_event_name: 'PreCompact'
  /** Claude Code's `manual` (its `/compact`) | `auto` (size-triggered — a checkpoint, here). */
  trigger: string
  /** Claude Code's `/compact` argument; always empty from this host, which has no such command. */
  custom_instructions: string
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
  /** PostToolUse `hookSpecificOutput.updatedToolOutput` — REPLACES the model-facing tool result content. */
  updatedToolOutput?: string
  /** PreToolUse `hookSpecificOutput.permissionDecision` + reason. */
  permissionDecision?: 'allow' | 'deny' | 'ask'
  permissionDecisionReason?: string
  /** PreToolUse `updatedInput` / `hookSpecificOutput.updatedInput`. */
  updatedInput?: unknown
}
