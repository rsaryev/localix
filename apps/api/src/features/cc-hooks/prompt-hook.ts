/**
 * Prompt-based CC hooks (`type:"prompt"`) — the pure fold layer.
 *
 * A prompt hook is an LLM-evaluated gate: the hook's `prompt` plus the event input
 * JSON go to a fast aux model, which must reply with `{ "ok": boolean, "reason"?: string }`.
 * The actual LLM call is injected by the chat runtime (agent-core / cc-hooks stay
 * chat-agnostic) via {@link PromptHookEvaluator}; this module owns only the two pure
 * pieces: (1) lenient parsing of the model's reply, (2) the per-event mapping of
 * `ok:false` onto a {@link CcHookOutcome}, exactly as the CC spec table dictates.
 *
 * Fail-open is the contract: an unparseable reply is treated as `ok:true`, marked `failed` so the
 * person sees a hook error rather than a silent allow.
 */
import { isPromptHookEvent, type CcHookEvent, type CcHookOutcome } from './contracts'
import { resolveLifecycleGate } from '@localixai/agent/runtime'
import { nativeLifecycleEvent } from './lifecycle-events'

export interface PromptHookResult {
  ok: boolean
  reason?: string
  /** `ok:false` with `impossible`: the model judges the condition can never hold (prompt hooks). */
  impossible?: boolean
  /**
   * Why no verdict was reached (no provider, an unusable model, a failed call, a reply without a
   * verdict). The gate stays open, as the hook page names no fail-closed rule for these two
   * types, but the person is told: it reaches the run as a non-blocking hook error.
   */
  failed?: string
}

/**
 * The injected single-shot evaluator. Given the composed prompt (hook prompt +
 * appended input JSON), an optional model hint, and a timeout, it returns the
 * model's parsed `{ok, reason}`. It MUST fail open (return `{ok:true}`) on any
 * error/timeout — the runtime never sees a throw.
 */
export type PromptHookEvaluator = (opts: {
  prompt: string
  inputJson: string
  model?: string
  timeoutMs: number
  signal?: AbortSignal
}) => Promise<PromptHookResult>

/** `$ARGUMENTS` not preceded by a backslash: the placeholder a prompt or agent hook names. */
const ARGUMENTS_PLACEHOLDER = /(?<!\\)\$ARGUMENTS/

/**
 * The text a `prompt` or `agent` hook sends (hooks.md, prompt hook configuration): `$ARGUMENTS`
 * becomes the hook input JSON, and without it the JSON is appended. A backslash escapes a dollar
 * sign (`\$1.00` reads `$1.00`, `\$ARGUMENTS` stays literal); the input JSON is never unescaped.
 */
export function hookPromptText(prompt: string, inputJson: string): string {
  const unescape = (text: string) => text.replace(/\\\$/g, '$')
  if (!ARGUMENTS_PLACEHOLDER.test(prompt)) return `${unescape(prompt)}\n\n${inputJson}`
  return prompt.split(new RegExp(ARGUMENTS_PLACEHOLDER, 'g')).map(unescape).join(inputJson)
}

/**
 * Extract `{ok, reason}` from a model reply. Lenient: scans for the FIRST balanced
 * `{…}` JSON object anywhere in the text (models like to wrap JSON in prose/fences).
 * `ok` accepts a boolean or the strings "true"/"false"/"yes"/"no". A reply with no
 * parseable object, or no usable `ok`, is treated as `ok:true` (fail-open).
 */
export function parsePromptHookResult(text: string): PromptHookResult {
  const obj = firstJsonObject(text)
  const ok = obj ? coerceOk(obj.ok) : undefined
  if (!obj || ok === undefined) return { ok: true, failed: NO_VERDICT }
  const reason = typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim() : undefined
  return {
    ok,
    ...(reason ? { reason } : {}),
    ...(!ok && obj.impossible === true ? { impossible: true } : {}),
  }
}

const NO_VERDICT = 'the model reply held no {"ok": …} verdict'

/** What the hook's own settings and type change about an `ok:false` (hooks.md, Response schema). */
export interface PromptVerdictOptions {
  /** An `agent` hook: handled as a prompt hook with `continueOnBlock: true`, `impossible` ignored. */
  agent?: boolean
  continueOnBlock?: boolean
}

/**
 * Map a prompt or agent hook's `{ok, reason}` onto the event's outcome (hooks.md, Response
 * schema). Where the page lets the turn go on, the reason goes back to Claude; where it ends the
 * turn by default, `continueOnBlock` (prompt hooks; an agent hook always) goes back instead.
 */
export function mapPromptOutcome(
  event: CcHookEvent,
  result: PromptHookResult,
  options: PromptVerdictOptions = {},
): CcHookOutcome {
  // The format owns its support matrix.
  if (!isPromptHookEvent(event)) return {}
  if (result.failed) return { failed: 'error', failureDetail: result.failed }
  if (result.ok) return {}
  const reason = result.reason
  const continues = options.agent === true || options.continueOnBlock === true
  // The turn ends with the reason as a warning line (`continue:false`), or Claude gets it back.
  const endsTurn = { continue: false as const, stopReason: reason || 'A hook stopped the run.' }
  if (event === 'Stop' || event === 'SubagentStop') {
    // `impossible` lets the turn end, so a condition that cannot hold never loops. Agent hooks
    // do not support it.
    return options.agent || !result.impossible ? { decision: 'block', reason } : {}
  }
  if (event === 'PreToolUse') {
    return {
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
      ...(continues ? {} : endsTurn),
    }
  }
  if (event === 'PostToolUse') {
    return continues ? { decision: 'block', reason } : endsTurn
  }
  if (event === 'PostToolUseFailure') return { decision: 'block', reason }
  const effect = resolveLifecycleGate(nativeLifecycleEvent(event), {
    accepted: false,
    reason,
  })
  switch (effect.kind) {
    case 'deny-tool':
      return { permissionDecision: 'deny', permissionDecisionReason: effect.reason }
    case 'reject-input':
      return { blocked: true, blockReason: effect.reason }
    case 'continue-run':
      return { decision: 'block', reason: effect.reason }
    case 'none':
      return {}
  }
}

// ---------------------------------------------------------------------------

function coerceOk(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 'yes') return true
    if (s === 'false' || s === 'no') return false
  }
  return undefined
}

/**
 * Find and parse the first balanced top-level `{…}` in `text`. Tracks brace depth
 * while respecting double-quoted strings + escapes so a `}` inside a string value
 * doesn't close the object early. Returns the parsed record or undefined.
 */
function firstJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  if (start === -1) return undefined
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1))
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}
