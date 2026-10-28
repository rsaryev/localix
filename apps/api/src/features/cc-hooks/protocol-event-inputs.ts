/**
 * Stdin inputs of the Claude Code events this host added after the first eleven, field for
 * field as the CC hooks reference names them. Common fields come from `CcHookInputBase`.
 */
import type { CcHookInputBase } from './protocol-types'

export interface CcUserPromptExpansionInput extends CcHookInputBase {
  hook_event_name: 'UserPromptExpansion'
  /** `slash_command` for a skill or plugin command; CC's `mcp_prompt` never occurs here. */
  expansion_type: 'slash_command'
  /** The matcher value: `plugin:command` for a plugin command, the skill name for a skill. */
  command_name: string
  command_args: string
  /** Where the command came from: `plugin`, or the skill's own source. */
  command_source: string
  /** The line as typed, `/name args`. */
  prompt: string
}
export interface CcPermissionRequestInput extends CcHookInputBase {
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: unknown
  permission_suggestions?: unknown[]
}
export interface CcPermissionDeniedInput extends CcHookInputBase {
  hook_event_name: 'PermissionDenied'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  reason: string
}
export interface CcToolBatchCall {
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  /** The content the model receives in the call's tool result. */
  tool_response: string
}
export interface CcPostToolBatchInput extends CcHookInputBase {
  hook_event_name: 'PostToolBatch'
  tool_calls: CcToolBatchCall[]
}
export interface CcStopFailureInput extends CcHookInputBase {
  hook_event_name: 'StopFailure'
  /** `rate_limit` | `authentication_failed` | `billing_error` | … | `unknown` — the matcher value. */
  error: string
  error_details?: string
  /** The rendered error text, as for CC's StopFailure (not the model's reply). */
  last_assistant_message?: string
}
export interface CcTaskEventInput extends CcHookInputBase {
  hook_event_name: 'TaskCreated' | 'TaskCompleted'
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}
export interface CcPostCompactInput extends CcHookInputBase {
  hook_event_name: 'PostCompact'
  trigger: string
  compact_summary: string
}
export interface CcInstructionsLoadedInput extends CcHookInputBase {
  hook_event_name: 'InstructionsLoaded'
  file_path: string
  /** `User` for the files under `~/.localix`, `Project` for the project's own. */
  memory_type: 'User' | 'Project' | 'Local' | 'Managed'
  /** `session_start`, or `compact` when the files are re-read after a context checkpoint. */
  load_reason: string
}
export interface CcConfigChangeInput extends CcHookInputBase {
  hook_event_name: 'ConfigChange'
  /** `user_settings` | `project_settings` | `local_settings` | `policy_settings` | `skills`. */
  source: string
  file_path?: string
}
export interface CcCwdChangedInput extends CcHookInputBase {
  hook_event_name: 'CwdChanged'
  old_cwd: string
  new_cwd: string
}
export interface CcFileChangedInput extends CcHookInputBase {
  hook_event_name: 'FileChanged'
  file_path: string
  event: 'change' | 'add' | 'unlink'
}
export interface CcModelSwitchInput extends CcHookInputBase {
  hook_event_name: 'PreModelSwitch' | 'PostModelSwitch'
  from_model: string
  to_model: string
  requested_model: string | null
  /** `command` for `/model`, `picker` for the model picker. */
  source: string
}

export interface CcElicitationInput extends CcHookInputBase {
  hook_event_name: 'Elicitation'
  /** The matcher value. */
  mcp_server_name: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  elicitation_id?: string
  requested_schema?: unknown
}
export interface CcElicitationResultInput extends CcHookInputBase {
  hook_event_name: 'ElicitationResult'
  mcp_server_name: string
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
  mode?: 'form' | 'url'
  elicitation_id?: string
}
export interface CcMessageDisplayInput extends CcHookInputBase {
  hook_event_name: 'MessageDisplay'
  turn_id: string
  message_id: string
  /** Always 0 here: Localix shows a settled message whole, as Claude Code's SDK mode does. */
  index: number
  final: boolean
  /** The whole message text. */
  delta: string
}
export interface CcWorktreeCreateInput extends CcHookInputBase {
  hook_event_name: 'WorktreeCreate'
  /** The worktree's slug: `<workflow run id>-<agent ordinal>` for a workflow agent. */
  name: string
}

export type CcAddedHookInput =
  | CcUserPromptExpansionInput
  | CcPermissionRequestInput
  | CcPermissionDeniedInput
  | CcPostToolBatchInput
  | CcStopFailureInput
  | CcTaskEventInput
  | CcPostCompactInput
  | CcInstructionsLoadedInput
  | CcConfigChangeInput
  | CcCwdChangedInput
  | CcFileChangedInput
  | CcModelSwitchInput
  | CcElicitationInput
  | CcElicitationResultInput
  | CcMessageDisplayInput
  | CcWorktreeCreateInput
