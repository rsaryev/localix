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
 * plain text is ignored. Never throws: malformed JSON is a parse failure (`failed`).
 */
export function foldHookOutput(text: string, allowPlainTextContext: boolean): CcHookOutcome {
  const trimmed = text.trim()
  if (!trimmed) return {}
  const plain = () => (allowPlainTextContext ? { additionalContext: trimmed } : {})
  // hooks.md, "Exit code 0": output that doesn't start with `{`, or doesn't end with `}`, is
  // plain text; anything else must be one JSON object, or the run is a parse failure.
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return plain()
  const json = parseJson(trimmed)
  if (json === undefined) {
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim())
    const each = lines.map((line) => parseJson(line.trim()))
    // Several lines that each parse are plain text, unless one of them is an output object.
    if (lines.length > 1 && each.every((value) => value !== undefined))
      return each.some(setsOutputField) ? parseFailure('several JSON objects') : plain()
    return parseFailure('invalid JSON')
  }
  if (!isRecord(json)) return parseFailure('not a JSON object')

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
    // Either form is kept as written; the tool it replaces decides what it may be.
    if (hso.updatedToolOutput !== undefined && hso.updatedToolOutput !== null)
      outcome.updatedToolOutput = hso.updatedToolOutput
    if (hso.updatedMCPToolOutput !== undefined && hso.updatedMCPToolOutput !== null)
      outcome.updatedMCPToolOutput = hso.updatedMCPToolOutput
    if (typeof hso.sessionTitle === 'string' && hso.sessionTitle.trim())
      outcome.sessionTitle = hso.sessionTitle.trim()
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** The fields of Claude Code's JSON output; an object with one of them is an output object. */
const OUTPUT_FIELDS = [
  'continue',
  'stopReason',
  'suppressOutput',
  'systemMessage',
  'decision',
  'reason',
  'hookSpecificOutput',
  'updatedInput',
  'terminalSequence',
  'watchPaths',
]

const setsOutputField = (value: unknown) =>
  isRecord(value) && OUTPUT_FIELDS.some((field) => field in value)

/** A parse failure is a non-blocking error: nothing applies, and no stdout becomes context. */
const parseFailure = (why: string): CcHookOutcome => ({
  failed: 'error',
  failureDetail: `hook output is not valid JSON output (${why})`,
})

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

/**
 * What an `async` hook says to Claude after it exits 0 (hooks.md, How async hooks execute): its
 * `additionalContext` and `systemMessage`, from a JSON response printed alone on stdout (it may
 * span several lines) or on one line of its own beside other text. Plain text says nothing.
 */
export function asyncHookContext(stdout: string): string | undefined {
  const fields = (outcome: CcHookOutcome) =>
    [outcome.additionalContext, outcome.systemMessage]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join('\n\n')
  const whole = fields(foldHookOutput(stdout, false))
  if (whole) return whole
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('{'))
  for (const line of lines.reverse()) {
    const said = fields(foldHookOutput(line, false))
    if (said) return said
  }
  return undefined
}
