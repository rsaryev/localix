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
    const decision = permissionRequestDecision(hso.decision)
    if (decision) outcome.permissionRequest = decision
    if (hso.retry === true) outcome.retry = true
    const action = hso.action
    if (action === 'accept' || action === 'decline' || action === 'cancel') {
      outcome.elicitation = {
        action,
        ...(isRecord(hso.content) ? { content: hso.content } : {}),
      }
    }
    if (typeof hso.displayContent === 'string') outcome.displayContent = hso.displayContent
    if (typeof hso.worktreePath === 'string' && hso.worktreePath.trim())
      outcome.worktreePath = hso.worktreePath.trim()
  }
  const watchPaths = stringArray(hso?.watchPaths) ?? stringArray(json.watchPaths)
  if (watchPaths) outcome.watchPaths = watchPaths
  return outcome
}

/** PermissionRequest's `decision` object; anything without a valid `behavior` is no decision. */
function permissionRequestDecision(raw: unknown): CcHookOutcome['permissionRequest'] {
  if (!isRecord(raw) || (raw.behavior !== 'allow' && raw.behavior !== 'deny')) return undefined
  return {
    behavior: raw.behavior,
    ...(raw.behavior === 'allow' && 'updatedInput' in raw
      ? { updatedInput: raw.updatedInput }
      : {}),
    ...(raw.behavior === 'deny' && typeof raw.message === 'string' ? { message: raw.message } : {}),
    ...(raw.behavior === 'deny' && raw.interrupt === true ? { interrupt: true } : {}),
  }
}

function stringArray(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : undefined
}

// oxlint-disable-next-line no-control-regex -- matches ESC-introduced CSI and OSC sequences
const ANSI_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?)/g

/**
 * A WorktreeCreate command hook's stdout (or an MCP tool's text, read the same way) is not the
 * JSON dialect: the path is its last non-empty line once ANSI escapes are stripped, so a shell
 * banner printed before the hook's `echo` is ignored, as in Claude Code.
 */
export function worktreePathFromText(text: string): CcHookOutcome {
  const lines = text
    .replace(ANSI_ESCAPE, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1]
  return last ? { worktreePath: last } : {}
}
