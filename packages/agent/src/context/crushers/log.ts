/**
 * Log crusher — structural compression for line-oriented tool output that is NOT
 * recoverable from disk: `bash`/`terminal` build, test and CLI logs. This is the
 * single biggest lossy target in the VBC pipeline (read results are recoverable and
 * get elided to a pointer; bash output can't be safely re-run, so today it only gets
 * dumb head/tail `truncate`).
 *
 * Strategy (deterministic, pure):
 *   - always keep a head (the command + early context) and a tail (the verdict),
 *   - keep error/failure lines and the indented stack frames that follow them,
 *   - keep summary lines (test counts, "build succeeded", "done in …"),
 *   - collapse runs of dropped noise into a "[… N lines omitted …]" marker,
 *   - collapse consecutive identical lines into "<line>  (×N)".
 *
 * Returns `null` for short logs or when the rewrite wouldn't shrink the text.
 */
import type { CrushResult } from './types'

export interface CrushLogOptions {
  /** Always-kept leading lines (command + setup). Default 4. */
  headLines?: number
  /** Always-kept trailing lines (the verdict). Default 12. */
  tailLines?: number
  /** Don't bother for logs shorter than this. Default 25. */
  minLines?: number
}

// Lines worth keeping verbatim. Conservative: when unsure, keep.
const ERROR_RE =
  /(\berror\b|\bfailed?\b|\bfailure\b|\bexception\b|traceback|panic|\bfatal\b|✗|✘|\bFAIL\b|segfault|assertion failed)/i
// Aggregate VERDICT lines only — not per-test "case 5 passed" noise. Requires a
// summary keyword, OR two adjacent counts ("1 failed, 90 passed"), so a single
// "<n> passed" inside a per-test line does not get kept.
const SUMMARY_RE =
  /(\btests?:\s|\btest suites?:|\bran\s+\d+\s+test|\d+\s+(passed|failed|skipped|errors?)\b[,;]?\s+\d+\s+(passed|failed|skipped|errors?|warnings?|total)|build (succeeded|failed|complete)|\bdone in\b|\bsummary\b)/i
// Indented continuation lines (stack frames, "File ..., line N", "at ...", "#N ...").
const STACK_RE = /^(\s+at\s|\s*File ".*", line \d+|\s+\.\.\.|\s+#\d+\s|\s{2,}\S)/
// Exception-chain connectors — keep the trace block going across them (Python's
// "During handling…/The above exception…", Java/JS "Caused by…", "... N more").
const CHAIN_RE =
  /^\s*(during handling of the above|the above exception was|caused by:|\.\.\.\s*\d+\s*more)/i
// Exception header lines (the type+message that ends a traceback) — e.g.
// "ValueError: x", "RuntimeError: y", "java.lang.NullPointerException: z". These
// often don't contain a standalone "error" word (it's mid-word in the class name).
const EXC_RE = /^[\w.$]*(Error|Exception|Warning|Fault|Failure)\b/
// Safety cap so a pathological all-indented blob can't keep the whole log.
const MAX_STACK_BLOCK = 60

export function crushLog(text: string, opts: CrushLogOptions = {}): CrushResult | null {
  const headLines = opts.headLines ?? 4
  const tailLines = opts.tailLines ?? 12
  const minLines = opts.minLines ?? 25
  const lines = text.split('\n')
  const total = lines.length
  if (total < minLines) return null

  const keep = Array.from({ length: total }, () => false)
  for (let i = 0; i < total; i++) {
    if (i < headLines || i >= total - tailLines) {
      keep[i] = true
      continue
    }
    const ln = lines[i]
    if (ERROR_RE.test(ln) || SUMMARY_RE.test(ln)) {
      keep[i] = true
      // Preserve the WHOLE contiguous stack/context block after an error line — full
      // tracebacks and chained exceptions, not a fixed window (which dropped frames
      // 9+). A blank line alone doesn't end it (Python interleaves them); two blanks,
      // a non-stack/non-chain line, or the safety cap does.
      let blanks = 0
      for (let j = i + 1; j < Math.min(total, i + 1 + MAX_STACK_BLOCK); j++) {
        const t = lines[j].trim()
        if (t === '') {
          if (++blanks >= 2) break
          keep[j] = true
          continue
        }
        blanks = 0
        if (
          STACK_RE.test(lines[j]) ||
          CHAIN_RE.test(lines[j]) ||
          ERROR_RE.test(lines[j]) ||
          EXC_RE.test(lines[j])
        )
          keep[j] = true
        else break
      }
    }
  }

  const out: string[] = []
  let keptLines = 0
  let i = 0
  while (i < total) {
    if (keep[i]) {
      // Collapse consecutive identical kept lines.
      let j = i + 1
      while (j < total && keep[j] && lines[j] === lines[i]) j++
      const dup = j - i
      out.push(dup > 1 ? `${lines[i]}  (×${dup})` : lines[i])
      keptLines += dup
      i = j
    } else {
      let j = i
      while (j < total && !keep[j]) j++
      out.push(`[… ${j - i} lines omitted …]`)
      i = j
    }
  }

  const result = out.join('\n')
  if (result.length >= text.length) return null
  return {
    text: result,
    beforeChars: text.length,
    afterChars: result.length,
    keptItems: keptLines,
    totalItems: total,
  }
}
