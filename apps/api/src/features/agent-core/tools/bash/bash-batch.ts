/** Sequential foreground batches, including their time and aggregate output budgets. */
import type {
  AgentToolResult,
  AgentToolExecutionContext,
  AgentToolUpdateCallback,
} from '@localixai/agent/agents'
import { resolveCwd, withEnvScripts, type BashRunContext } from './bash-run-context'
import { withCommandShims } from './bash-shims'
import {
  BATCH_OUTPUT_BUDGET_BYTES,
  modelFacingOutput,
  spillFullOutput,
  SPILL_MIN_BYTES,
  truncate,
} from './bash-output'
import type { BashToolInput, BashToolDetails } from './bash-types'
import { isTerminationSignalExit } from '../../../../lib/process-exit'
import { isNoFindingsExit } from './soft-exit'

type Updater = AgentToolUpdateCallback<BashToolDetails>
type Ctx = AgentToolExecutionContext

// ── Batch mode: several commands run sequentially in ONE call ─────────
// Foreground only. Saves a model round-trip (and a full system-prompt
// prefill) per command vs issuing them as separate bash calls. Reuses the
// same env.exec + truncation, and emits one aggregated BashToolDetails so
// the existing command card renders it unchanged.
/**
 * Wall-clock ceiling for ONE batch call, in seconds.
 *
 * `timeout` bounds each command; nothing bounded the batch. The tool's own description tells the
 * model to "Pass them ALL as `commands: [...]` in ONE call", so `commands: [40 entries]` with
 * `timeout: 600` was a single tool call allowed to occupy the turn for four hours, with the abort
 * signal as the only brake — and the stream has no overall turn timeout either (only a 60s IDLE cap,
 * which a running command resets).
 *
 * 600s, because that is already the ceiling the schema allows a SINGLE command: a batch may not
 * outlast the longest call it replaced. A count cap was the alternative and is worse — 20 fast
 * commands are fine and 3 slow ones are not, so the resource to bound is time, not entries, and a
 * count cap would also contradict the description's advice to batch aggressively.
 */
const BATCH_WALL_BUDGET_SECONDS = 600

export async function runBatchCommands(
  ctx: BashRunContext,
  toolCallId: string,
  input: BashToolInput,
  signal: AbortSignal | undefined,
  onUpdate: Updater | undefined,
  context: Ctx | undefined,
): Promise<AgentToolResult<BashToolDetails>> {
  const cmds = input.commands!
  const cwd = resolveCwd(input, ctx.defaultCwd)
  const timeoutSecs = input.timeout ?? 60
  const keepGoing = input.keep_going ?? false
  const startAll = Date.now()
  // Each stream across the batch, for a PostToolUse hook's `stdout` / `stderr`.
  const stdoutParts: string[] = []
  const stderrParts: string[] = []
  const results: {
    command: string
    exitCode: number
    output: string
    wallTimeMs: number
    spillPath?: string | null
  }[] = []

  const unregister = context?.asyncRegistry?.registerActions(toolCallId, {
    kill: {
      label: 'Kill',
      icon: 'square',
      execute: () => {
        context?.asyncRegistry?.abortSession?.()
      },
    },
  })

  // A foreground command TERMINATED by a stop signal (a `npm run dev` SIGTERM'd at
  // the bash timeout/teardown, a watch-reload SIGKILL, ^C) was told to stop — it is
  // NOT a task failure (crash signals like SIGSEGV are NOT in this set and still
  // count). The background classifier already does this; mirror it foreground so a
  // worker that started a server doesn't read its own teardown as "the build failed".
  const statusOf = (code: number) =>
    code === 0
      ? 'ok'
      : code === 124
        ? 'timeout'
        : isTerminationSignalExit(code)
          ? `terminated (signal ${code - 128})`
          : `exit ${code}`
  const uiBlocks = () =>
    results
      .map(
        (r) =>
          `$ ${r.command}  [${statusOf(r.exitCode)}, ${r.wallTimeMs}ms]\n${r.output || '(no output)'}`,
      )
      .join('\n\n')

  let aborted = false
  let budgetSpent = false
  for (let i = 0; i < cmds.length; i++) {
    if (signal?.aborted) {
      aborted = true
      break
    }
    // Checked BEFORE starting a command, never mid-flight: interrupting a running process is
    // `timeout`'s job, and killing one halfway would leave the batch's own report ambiguous about
    // whether it ran. A command already started is always allowed to finish — including the first
    // one, which this can never refuse because `startAll` is taken immediately before the loop, so
    // the elapsed time at index 0 is zero by construction. That matters: a single command may
    // legally take the full 600s, so a one-entry batch must never be turned away.
    if (Date.now() - startAll >= BATCH_WALL_BUDGET_SECONDS * 1000) {
      budgetSpent = true
      break
    }
    const startMs = Date.now()
    let exitCode: number
    let combined: string
    try {
      const r = await ctx.env.exec(withEnvScripts(ctx, withCommandShims(cmds[i])), {
        cwd,
        timeout: timeoutSecs,
        signal,
        pathPrefix: ctx.pluginBinDirs,
      })
      exitCode = r.exitCode
      combined = (r.stdout + (r.stderr ? '\n' + r.stderr : '')).trimEnd()
      if (r.stdout.trim()) stdoutParts.push(r.stdout.trimEnd())
      if (r.stderr?.trim()) stderrParts.push(r.stderr.trimEnd())
    } catch (err) {
      exitCode = -1
      combined = err instanceof Error ? err.message : 'Process failed'
    }
    results.push({
      command: cmds[i],
      exitCode,
      output: truncate(combined),
      wallTimeMs: Date.now() - startMs,
      // Past the model-facing cap the tail truncation is certain; keep the full
      // captured text on disk so the model reads/greps it instead of re-running.
      spillPath:
        combined.length > SPILL_MIN_BYTES
          ? await spillFullOutput(combined, `${toolCallId}-${i}`)
          : null,
    })
    onUpdate?.({
      command: cmds.join('\n'),
      cwd,
      output: uiBlocks(),
      isStreaming: i < cmds.length - 1,
    })
    if (
      exitCode !== 0 &&
      !isTerminationSignalExit(exitCode) &&
      !isNoFindingsExit(cmds[i], exitCode) &&
      !keepGoing
    )
      break
  }
  unregister?.()

  const ran = results.length
  const remaining = cmds.length - ran
  // A stop-signal exit is not a failure (see statusOf), so it neither flags the
  // result as an error nor halts a multi-command run. Same for a grep/diff-family
  // exit 1 — a findings status, not a failure (soft-exit.ts).
  const failed = (r: { command: string; exitCode: number }) =>
    r.exitCode !== 0 &&
    !isTerminationSignalExit(r.exitCode) &&
    !isNoFindingsExit(r.command, r.exitCode)
  const firstFail = results.find(failed)
  const stoppedEarly = remaining > 0 && !aborted && !budgetSpent
  // `keep_going` means the model EXPECTS some commands to fail and asked to run the
  // rest anyway (20 `git diff -- <path>` where one path was deleted). Flagging the
  // whole call an error there is a false negative with teeth: the loop's
  // consecutive-tool-errors guard stops a run after 3 such turns (`loop.ts`), so the
  // very batching that saves round-trips would kill the run. The call failed only if
  // NOTHING succeeded; the per-command `[exit N]` markers and the summary line below
  // carry the partial failures. Without `keep_going` the run halts at the first
  // failure, so any failure IS the call's outcome — unchanged.
  //
  // Zero commands succeeded → a retryable error;
  // any partial success → a normal result whose body names what still needs fixing.
  const allFailed = ran > 0 && results.every(failed)
  const isError = aborted || (keepGoing ? allFailed : Boolean(firstFail))

  // ── Aggregate output budget ───────────────────────────────────────────────
  // Each block is individually capped, but concatenating N of them was not — see
  // BATCH_OUTPUT_BUDGET_BYTES for the measurements. Spend the budget on FAILED commands first: in a
  // batch, "which one failed and why" is the whole question, and a failure can sit anywhere in the
  // list. Print order stays the command order regardless; only the choice of what to elide is
  // priority-based.
  const built = results.map((r, index) => ({
    index,
    isFailure: failed(r),
    text: `$ ${r.command}\n[${statusOf(r.exitCode)}, ${r.wallTimeMs}ms]\n${
      modelFacingOutput(r.output, {
        command: r.command,
        toolCallId,
        spillPath: r.spillPath,
      }).trim() || '(no output)'
    }`,
  }))
  const kept = new Set<number>()
  let spentBytes = 0
  for (const block of [...built.filter((b) => b.isFailure), ...built.filter((b) => !b.isFailure)]) {
    // `kept.size > 0` keeps ONE block whatever its size, so a result can never come back with every
    // block elided and nothing readable in it. No input reaches that today — the per-command cap
    // holds any single block near 51KB, far under the budget — so this is a floor against the budget
    // being lowered or the per-command cap being raised, not a live path.
    if (kept.size > 0 && spentBytes + block.text.length > BATCH_OUTPUT_BUDGET_BYTES) continue
    kept.add(block.index)
    spentBytes += block.text.length
  }
  const elided = built.filter((b) => !kept.has(b.index))
  const modelBlocks = built.map((b) => {
    if (kept.has(b.index)) return b.text
    const r = results[b.index]!
    // The status still comes through — only the body is dropped, and it stays reachable when the
    // command was large enough to have been spilled.
    const where = r.spillPath ? ` — full output at ${r.spillPath}` : ''
    return `$ ${r.command}\n[${statusOf(r.exitCode)}, ${r.wallTimeMs}ms] output omitted (batch output budget spent)${where}`
  })
  let content = modelBlocks.join('\n\n') || '(no output)'
  if (elided.length > 0) {
    content +=
      `\n\n[output of ${elided.length} of ${ran} command(s) omitted — the batch reached its ` +
      `${Math.round(BATCH_OUTPUT_BUDGET_BYTES / 1000)}KB output budget. Exit statuses above are complete; ` +
      `re-run a specific command alone, or read its spill file, to see its output.]`
  }
  if (aborted) content += `\n\n[aborted — ${remaining} command(s) not run]`
  else if (budgetSpent)
    content +=
      `\n\n[batch time budget of ${BATCH_WALL_BUDGET_SECONDS}s reached after ${ran} command(s) — ` +
      `${remaining} not run: ${cmds.slice(ran).join(', ')}. Re-issue the remaining commands in a new call.]`
  else if (stoppedEarly)
    content += `\n\n[stopped after a failed command — ${remaining} remaining command(s) not run; set keep_going:true to run them all]`
  else if (keepGoing && firstFail) {
    // With keep_going the run does NOT stop at the first failure, so a single bad
    // command can hide among twenty blocks of output. State the bottom line — a
    // result must say what it actually contains.
    const failures = results.filter(failed)
    content += `\n\n[${failures.length} of ${ran} command(s) failed (keep_going): ${failures.map((r) => r.command).join(', ')}]`
  }

  const details: BashToolDetails = {
    command: cmds.join('\n'),
    cwd,
    output: uiBlocks(),
    isStreaming: false,
    // 124 is the timeout convention this file already reads (`statusOf`), so a batch cut short by
    // its own wall budget reports the same way a single timed-out command does.
    exitCode: firstFail?.exitCode ?? (aborted ? 130 : budgetSpent ? 124 : 0),
    wallTimeMs: Date.now() - startAll,
    // The CARD stays visually honest even when the call is not an error: a
    // keep_going batch with one bad command shows as failed, with its exit code — and a batch that
    // ran out of time is not "completed" while commands it was given never started.
    jobStatus: aborted || firstFail ? 'failed' : budgetSpent ? 'timeout' : 'completed',
    ...(stderrParts.length
      ? { stdout: truncate(stdoutParts.join('\n')), stderr: truncate(stderrParts.join('\n')) }
      : {}),
  }
  onUpdate?.(details)
  return { content, details, isError }
}
