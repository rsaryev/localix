import { stripAnsi, collapseCarriageReturns } from './sanitize-ansi'
import { redactSecrets } from './redact-secrets'

/**
 * Unconditional pre-stage for the model-facing bash output: terminal-noise
 * strip + secret redaction, composed in dependency order — ANSI first (a
 * secret split by an SGR sequence must be re-joined before the redaction
 * patterns can see it), `\r` collapse second (operates on clean lines), the
 * redactor last.
 *
 * PLACEMENT — this deliberately does NOT live inside `applyOutputFilters`:
 * that registry is per-runner-matched, gated on a known `command` and a
 * 20-line minimum, and wrapped in `neverWorse` — all correct for optional
 * token-saving rewrites, all wrong for redaction. A one-line `echo $AWS_KEY`
 * must be scrubbed too, and redaction may legitimately GROW the text by a few
 * bytes (`[REDACTED:…]` markers), which `neverWorse` would silently discard.
 * So the callsite is `modelFacingOutput` (bash-output.ts) — the single funnel
 * every model-facing bash result flows through (foreground single command,
 * foreground batch, background completion) — as its first step, BEFORE the
 * per-runner filters and the volumetric tail cap. The UI copy
 * (`details.output`) and the spill file stay raw, like every other filter.
 *
 * Idempotent by construction (sanitize(sanitize(x)) === sanitize(x)): the
 * strippers leave no ESC/`\r` behind, and a `…[REDACTED:kind]` marker can
 * never re-satisfy a redaction pattern.
 */
export function sanitizeModelOutput(output: string): string {
  return redactSecrets(collapseCarriageReturns(stripAnsi(output)))
}
