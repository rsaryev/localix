import type { AgentToolResult } from './tool-result'

export interface BeforeToolCallContext {
  toolCallId: string
  toolName: string
  input: unknown
  /** Optional human-readable source for nested tool calls, e.g. a delegate title. */
  sourceTitle?: string
  /**
   * Set for a call a tool makes on its own behalf (`AgentToolExecutionContext.callTool`): the
   * call the person sees in the transcript, which a prompt about this one belongs to.
   */
  parentToolCallId?: string
}
/**
 * How a gated tool call was ALLOWED — the permission gate's decision provenance,
 * carried onto the tool item so the UI can explain "why did this run without
 * asking?". Only non-default outcomes are recorded (a plain default-allow with
 * no matching rule stays undefined — badging every call would be noise).
 */
export interface ToolGateProvenance {
  /**
   * - `user-approved` — a human approved THIS call via the confirm prompt.
   * - `session-grant` — auto-approved by an earlier session-wide "Always allow".
   * - `rule-allow` — an explicit allow rule matched (skill allowed-tools /
   *   project or mode permission rule).
   */
  decision: 'user-approved' | 'session-grant' | 'rule-allow'
  /** Human-readable source, e.g. the matched rule (`bash(git *)`). */
  detail?: string
}

// NB: neither hook context carries the conversation `messages`. It used to — and the
// runtime adapter paid a FULL history conversion per tool call, twice, for a field no
// consumer (permission gate, externalizer, plugin hooks) ever read. A hook that one
// day needs history should get a lazy accessor, not a pre-built copy.
export interface AfterToolCallContext {
  toolCallId: string
  toolName: string
  input: unknown
  result: AgentToolResult
}
export interface AfterToolCallResult {
  content?: string
  isError?: boolean
  terminate?: boolean
}
