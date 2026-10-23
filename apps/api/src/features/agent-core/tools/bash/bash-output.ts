import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { truncateTail } from '@localixai/agent'
import { localixHome } from '../../../../lib/env'
import { safeFileKey } from '@localixai/mini-app-sdk/backend'
import { truncationMarker } from '../tool-output'
import { applyOutputFilters, sanitizeModelOutput } from './output-filters'

export const MAX_OUTPUT_BYTES = 100_000

/**
 * Ceiling on the MODEL-facing text a whole `commands` batch may contribute, in bytes.
 *
 * {@link MAX_OUTPUT_BYTES} and the tail cap bound ONE command. A batch concatenated its per-command
 * blocks with no aggregate limit, so the bound was per-call only in the single-command shape.
 * Measured before this existed, each block landing at ~51KB of model-facing text:
 *
 *   1 command  →  51,475 bytes
 *   5 commands →  257,383
 *   12 commands → 617,739     (and nothing caps the array length, so 40 → ~2MB)
 *
 * That is a single tool result larger than any context window, re-sent every turn until a checkpoint.
 * The batch already has a wall-clock budget that stops starting commands and names the ones it
 * skipped; this is the same idea for bytes, with two differences that matter: the commands have
 * already RUN by the time their size is known (so nothing is skipped — only their output is elided),
 * and every command's exit status survives, because "which one failed" is the question a batch
 * answers.
 *
 * 200KB ≈ four full-size blocks, and dozens of ordinary ones — batching cheap commands, which this
 * tool's own description urges, is unaffected. Anything cut is still addressable: a command over
 * {@link SPILL_MIN_BYTES} has its complete output on disk and the elision names the file.
 */
export const BATCH_OUTPUT_BUDGET_BYTES = 200_000

/**
 * Above this, the model-facing cap (50KB tail) is guaranteed to cut the output,
 * so the full captured text is spilled to a file the model can read/grep instead
 * of re-running the command (which may be slow, non-idempotent, or produce the
 * same overflow again).
 */
export const SPILL_MIN_BYTES = 50 * 1024

const SPILL_MAX_AGE_MS = 48 * 60 * 60 * 1000

function spillDir(): string {
  return join(localixHome(), 'tmp', 'bash-output')
}

/**
 * Persist the full captured command output (bounded upstream by the 2MB capture
 * cap in environments/spawn.ts) so truncation never destroys it. Returns the
 * absolute path, or null when the write fails — spilling is best-effort and must
 * never fail the command itself. Old spills are reaped opportunistically.
 */
export async function spillFullOutput(
  output: string,
  key: string,
  dir = spillDir(),
): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true })
    void reapOldSpills(dir)
    const file = join(dir, `${safeFileKey(key)}-${Date.now()}.log`)
    await writeFile(file, output, 'utf8')
    return file
  } catch {
    return null
  }
}

async function reapOldSpills(dir: string): Promise<void> {
  try {
    const cutoff = Date.now() - SPILL_MAX_AGE_MS
    for (const name of await readdir(dir)) {
      const file = join(dir, name)
      const s = await stat(file).catch(() => null)
      if (s && s.mtimeMs < cutoff) await unlink(file).catch(() => {})
    }
  } catch {
    // reaping is opportunistic
  }
}

/** Records that bytes were dropped — the only thing a reader has left to tell them by. */
const TRUNCATION_MARKER = '[…truncated…]'

export function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_BYTES) return output
  return `${TRUNCATION_MARKER}\n${output.slice(-MAX_OUTPUT_BYTES)}`
}

/** A growing capture bounded to the same tail {@link truncate} keeps. */
export interface BoundedOutput {
  append(chunk: string): void
  /** The bounded view — identical to `truncate` of everything appended. */
  text(): string
}

/**
 * Accumulate process output without re-copying the buffer on every chunk.
 *
 * `buffer = truncate(buffer + chunk)` looks harmless and is not: past the cap it copies the
 * whole retained tail twice per chunk, and a pipe delivers chunks the size of its read
 * buffer rather than the size of the output. This repo has already measured that exact
 * expression on its PTY path — 12,942 chunks from one `ls -R` cost 74.8 ms of event-loop
 * time (see terminal/session.ts) — and fixed it there while this path kept it.
 *
 * Two changes, neither of which alters a single retained byte. The trim is AMORTIZED, so it
 * runs at most once per {@link MAX_OUTPUT_BYTES} of data instead of once per chunk (the same
 * `CAP * 2` slack `environments/spawn.ts` already uses for foreground capture) — the tail of
 * a stream is the same tail whether it was trimmed eagerly or late. And the bounded view is
 * MEMOIZED, so the truncation is paid by the reader that asks, of which there are a handful
 * per second, rather than by every chunk that arrives.
 */
export function createBoundedOutput(): BoundedOutput {
  let raw = ''
  let view: string | undefined
  // Whether anything was ever dropped, remembered rather than inferred. Length cannot answer
  // it once the trim lands exactly on the cap, and a reader that lost bytes without being
  // told would read a partial log as a complete one.
  let dropped = false
  return {
    append(chunk) {
      raw += chunk
      if (raw.length > MAX_OUTPUT_BYTES * 2) {
        raw = raw.slice(-MAX_OUTPUT_BYTES)
        dropped = true
      }
      view = undefined
    },
    text() {
      view ??= dropped ? `${TRUNCATION_MARKER}\n${raw.slice(-MAX_OUTPUT_BYTES)}` : truncate(raw)
      return view
    },
  }
}

/** Command context for content-aware output filtering (test-runner filters etc.). */
export interface ModelOutputContext {
  command?: string
  toolCallId?: string
  /** Where the full captured output was spilled, when it exceeded SPILL_MIN_BYTES. */
  spillPath?: string | null
}

/**
 * Trim the MODEL-facing command output. Content-aware filters run FIRST
 * (recognized test-runner output → summary/failures-only; never-worse +
 * fail-safe guarded), then the volumetric tail cap. Command/log output puts
 * the errors and final result at the END, so the cap keeps the tail (last N
 * lines / bytes). The richer `details.output` (UI) keeps the wider 100KB cap
 * and stays RAW; this only shrinks what is re-sent into the prompt every turn.
 * No-op below the default limits for unrecognized output.
 */
export function modelFacingOutput(output: string, ctx?: ModelOutputContext): string {
  // Unconditional pre-stage: ANSI/OSC/DCS strip + `\r` progress collapse +
  // secret redaction. Runs here — not in the filter registry — because it
  // must cover EVERY model-facing result (no command gate, no line-count
  // minimum, no never-worse discard); rationale in output-filters/sanitize.ts.
  output = sanitizeModelOutput(output)
  if (ctx?.command) output = applyOutputFilters(ctx.command, output, ctx.toolCallId)
  const r = truncateTail(output)
  if (!r.truncated) return output
  const marker = truncationMarker(r, {
    kept: 'last',
    // With a spill file the model never has to re-run the command (slow,
    // possibly non-idempotent) to see the cut portion — read/grep the file.
    advice: ctx?.spillPath
      ? `Complete captured output saved to ${ctx.spillPath} — read/search/grep that file for the rest instead of re-running.`
      : 'For the rest, re-run filtered (grep/head/tail) or redirect to a file and read it.',
  })
  return `${marker}\n${r.content}`
}
