/**
 * Shared "command-hook stdout" fold — the single place that turns a hook's raw
 * text output into a normalized {@link CcHookOutcome}.
 *
 * Per the CC spec, three handler types speak the SAME output dialect:
 *   - `command`  — its exit-0 stdout;
 *   - `http`     — a 2xx response body;
 *   - `mcp_tool` — the called tool's result text.
 * All three parse identically: a leading `{` ⇒ the JSON output schema (universal
 * fields + `hookSpecificOutput`); otherwise plain text, which becomes
 * `additionalContext` only on the context-adding events.
 *
 * Pure module — no chat/UI/Node imports.
 */
import type { CcHookOutcome } from './contracts'
import { isRecord } from '../../lib/record'

/**
 * Fold a hook's raw text output (stdout / HTTP body / MCP tool text) into an
 * outcome. `allowPlainTextContext` is true for the events where non-JSON output
 * is added to the model context (SessionStart / UserPromptSubmit); elsewhere
 * plain text is ignored. Never throws — malformed JSON degrades to plain text.
 */
export function foldHookOutput(text: string, allowPlainTextContext: boolean): CcHookOutcome {
  const trimmed = text.trim()
  if (!trimmed) return {}
  if (!trimmed.startsWith('{')) {
    return allowPlainTextContext ? { additionalContext: trimmed } : {}
  }
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    return allowPlainTextContext ? { additionalContext: trimmed } : {}
  }
  if (!isRecord(json)) return {}

  const outcome: CcHookOutcome = {}
  if (json.continue === false) outcome.continue = false
  if (typeof json.stopReason === 'string') outcome.stopReason = json.stopReason
  if (typeof json.systemMessage === 'string') outcome.systemMessage = json.systemMessage
  if (json.decision === 'block') outcome.decision = 'block'
  if (typeof json.reason === 'string') outcome.reason = json.reason
  // Top-level updatedInput (PreToolUse convenience form).
  if ('updatedInput' in json) outcome.updatedInput = json.updatedInput

  const hso = isRecord(json.hookSpecificOutput) ? json.hookSpecificOutput : undefined
  if (hso) {
    if (typeof hso.additionalContext === 'string') outcome.additionalContext = hso.additionalContext
    if (typeof hso.updatedToolOutput === 'string') outcome.updatedToolOutput = hso.updatedToolOutput
    const pd = hso.permissionDecision
    if (pd === 'allow' || pd === 'deny' || pd === 'ask') outcome.permissionDecision = pd
    if (typeof hso.permissionDecisionReason === 'string') {
      outcome.permissionDecisionReason = hso.permissionDecisionReason
    }
    if ('updatedInput' in hso) outcome.updatedInput = hso.updatedInput
  }
  return outcome
}
