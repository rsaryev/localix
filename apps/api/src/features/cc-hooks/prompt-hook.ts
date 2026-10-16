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
 * Fail-open is the contract: an unparseable reply is treated as `ok:true`.
 */
import { isPromptHookEvent, type CcHookEvent, type CcHookOutcome } from './contracts'
import { resolveLifecycleGate } from '@localixai/agent/runtime'
import { nativeLifecycleEvent } from './lifecycle-events'

export interface PromptHookResult {
  ok: boolean
  reason?: string
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

/**
 * Extract `{ok, reason}` from a model reply. Lenient: scans for the FIRST balanced
 * `{…}` JSON object anywhere in the text (models like to wrap JSON in prose/fences).
 * `ok` accepts a boolean or the strings "true"/"false"/"yes"/"no". A reply with no
 * parseable object, or no usable `ok`, is treated as `ok:true` (fail-open).
 */
export function parsePromptHookResult(text: string): PromptHookResult {
  const obj = firstJsonObject(text)
  if (!obj) return { ok: true }
  const ok = coerceOk(obj.ok)
  if (ok === undefined) return { ok: true }
  const reason = typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim() : undefined
  return reason ? { ok, reason } : { ok }
}

/** Map a prompt hook's `{ok, reason}` onto the event's outcome (CC §7 response schema). */
export function mapPromptOutcome(event: CcHookEvent, result: PromptHookResult): CcHookOutcome {
  // The format owns its support matrix.
  if (!isPromptHookEvent(event)) return {}
  const effect = resolveLifecycleGate(nativeLifecycleEvent(event), {
    accepted: result.ok,
    reason: result.reason,
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
