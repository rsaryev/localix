/**
 * The BACKGROUND bash run path: a long-lived JOB, not a command that finishes.
 *
 * It owns everything the foreground paths (`bash-run.ts`) never need — choosing a PTY
 * pane over a detached child, throttled output streaming, the early-output settle
 * window, the kill/timeout/exit classification, the kill + send_input async actions,
 * and the job-id protocol the model polls with. All of that is invisible to the
 * caller, which only sees the same `AgentToolResult<BashToolDetails>` shape.
 */
import type {
  AgentToolResult,
  AgentToolExecutionContext,
  AgentToolUpdateCallback,
} from '@localixai/agent/agents'

import { renderBackgroundStartResult } from './bash-background-result'
import { awaitBackgroundSettle } from './bash-background-settle'
import {
  createBoundedOutput,
  modelFacingOutput,
  spillFullOutput,
  SPILL_MIN_BYTES,
} from './bash-output'
import { childBgProc, ptyBgProc, type BgProc, type BackgroundInputPayload } from './bash-process'
import { classifyBgExit, type BashToolInput, type BashToolDetails } from './bash-types'
import type { BashRunContext } from './bash-run'

const BACKGROUND_STREAM_THROTTLE_MS = 120
// Before returning from a background spawn, briefly watch its output so the model
// sees the early lines that matter (e.g. a dev server's "Local: http://localhost:XXXX",
// a compile error, an immediate crash) in the SAME turn — instead of moving on blind
// and wasting tool calls hunting for the port / status. The job keeps running after.
const BACKGROUND_SETTLE_MIN_MS = 2_000
const BACKGROUND_SETTLE_MAX_MS = 3_000
const BACKGROUND_SETTLE_QUIET_MS = 350

type Updater = AgentToolUpdateCallback<BashToolDetails>
type Ctx = AgentToolExecutionContext

/**
 * A foreground command promoted to the background: its child outran the call's
 * timeout and was handed over alive (see spawn.ts's `onTimeout: 'detach'`) instead
 * of killed, so the work continues as an ordinary job.
 */
export interface AdoptedJob {
  proc: BgProc
  /** The foreground budget it outran, quoted back to the model so the reason is explicit. */
  foregroundSecs: number
}

// ── Background mode (local only — guarded by the caller) ──────────────────────
export async function runBackgroundCommand(
  ctx: BashRunContext,
  toolCallId: string,
  input: BashToolInput,
  cwd: string,
  execCommand: string,
  timeoutSecs: number,
  startMs: number,
  signal: AbortSignal | undefined,
  onUpdate: Updater | undefined,
  context: Ctx | undefined,
  adopted?: AdoptedJob,
): Promise<AgentToolResult<BashToolDetails>> {
  // Guarded by the caller: this path is only reached when `command` is set.
  const command = input.command!
  // Run in a PTY pane when a terminal host is wired (user can watch +
  // interact), else a detached child process. Same job lifecycle either way.
  // An ADOPTED job skips this entirely: its process already exists and is a plain
  // child (a promoted foreground command never had a PTY pane to run in).
  let proc: BgProc
  if (adopted) {
    proc = adopted.proc
  } else {
    try {
      proc = ctx.spawnTerminalJob
        ? await ptyBgProc(ctx.spawnTerminalJob, cwd, execCommand, {
            wakesAgent: input.notify === true,
          })
        : childBgProc(execCommand, cwd, ctx.pluginBinDirs)
    } catch {
      proc = childBgProc(execCommand, cwd, ctx.pluginBinDirs)
    }
  }
  let bgExitCode: number | null = null
  let bgDone = false
  void proc.exited.then((code) => {
    bgExitCode = code
    bgDone = true
  })

  // Lazy preview wiring: when the PTY host detects a served localhost URL in this
  // job's output, remember it so browser can auto-open it on the first
  // drive. The host owns detection (content-based, never from the command string);
  // bash forwards the URL and — as provenance, not as a detection input — the command
  // that printed it, which is the only place that knows how this server starts. Without
  // it a preview whose server dies can only offer a dead reload, whatever it was run
  // with (`npm run dev`, `node server.js`, a compose stack, anything).
  if (ctx.recordPreviewTarget) {
    proc.onPreviewUrl?.((url) => ctx.recordPreviewTarget!(url, command, cwd))
  }

  // Amortized + memoized: see createBoundedOutput. `bgOutput()` reads the same bounded view
  // the eager `truncate(bgOutput + chunk)` used to store on every chunk.
  const capture = createBoundedOutput()
  const bgOutput = () => capture.text()
  let bgSettled = false
  let bgFlushTimer: ReturnType<typeof setTimeout> | null = null
  const flushBackgroundUpdate = () => {
    bgFlushTimer = null
    context?.asyncRegistry?.emitBackground(toolCallId, bgOutput(), {
      details: {
        command: command,
        cwd,
        isStreaming: true,
        isBackground: true,
        jobStatus: 'running',
        terminalId: proc.terminalId,
      },
    })
  }
  const scheduleBackgroundFlush = () => {
    if (bgFlushTimer) return
    bgFlushTimer = setTimeout(flushBackgroundUpdate, BACKGROUND_STREAM_THROTTLE_MS)
  }

  const bgKilled = { byUser: false, byTimeout: false }
  const doBgKill = (reason: 'user' | 'timeout') => {
    if (bgSettled) return
    if (reason === 'user') bgKilled.byUser = true
    else bgKilled.byTimeout = true
    proc.kill()
  }
  const onBgAbort = () => doBgKill('user')
  signal?.addEventListener('abort', onBgAbort, { once: true })
  const unregisterBg = context?.asyncRegistry?.registerActions(toolCallId, {
    kill: {
      label: 'Kill',
      icon: 'square',
      execute: () => {
        doBgKill('user')
      },
    },
    send_input: {
      label: 'Send Input',
      execute: (payload?: unknown) => {
        const text = (payload as BackgroundInputPayload | undefined)?.text
        if (!text || bgSettled) return
        proc.write(text)
      },
    },
  })
  if (proc.terminalId)
    context?.asyncRegistry?.setBackgroundJobTerminalId?.(toolCallId, proc.terminalId)
  const bgCleanup = () => {
    bgSettled = true
    if (bgFlushTimer) {
      clearTimeout(bgFlushTimer)
      bgFlushTimer = null
    }
    unregisterBg?.()
    signal?.removeEventListener('abort', onBgAbort)
  }
  const initialDetails: BashToolDetails = {
    command: command,
    cwd,
    output: '',
    isStreaming: true,
    isBackground: true,
    background: adopted ? 'promoted' : 'requested',
    jobStatus: 'running',
    terminalId: proc.terminalId,
  }
  onUpdate?.(initialDetails)
  // timeoutSecs === 0 means no timeout (background tasks run until done).
  const bgTimeout =
    timeoutSecs > 0 ? setTimeout(() => doBgKill('timeout'), timeoutSecs * 1000) : undefined

  let bgLastChunkAt = 0
  // `proc.onOutput` attaches the stream (and replays an adopted job's capture) per call, so the
  // settle window listens here rather than registering a second output listener.
  const chunkListeners = new Set<() => void>()
  proc.onOutput((chunk) => {
    capture.append(chunk)
    bgLastChunkAt = Date.now()
    scheduleBackgroundFlush()
    for (const listener of chunkListeners) listener()
  })

  void (async () => {
    try {
      const exitCode = await proc.exited
      clearTimeout(bgTimeout)
      if (bgFlushTimer) {
        clearTimeout(bgFlushTimer)
        flushBackgroundUpdate()
      }
      const wallTimeMs = Date.now() - startMs
      const jobStatus = classifyBgExit({
        byUser: bgKilled.byUser,
        byTimeout: bgKilled.byTimeout,
        exitCode: exitCode ?? null,
      })
      const settledOutput = bgOutput()
      const finalOutput = bgKilled.byUser
        ? settledOutput + '\n[Killed by user]'
        : bgKilled.byTimeout
          ? settledOutput + `\n[Timed out after ${timeoutSecs}s]`
          : exitCode !== 0
            ? settledOutput + `\n[exit ${exitCode}]`
            : settledOutput
      // Model-facing copy gets the content-aware filter (test-runner output →
      // summary/failures); the UI copy below (onUpdate) stays raw.
      // `modelFacingOutput`, not a bare filter: it applies the content-aware filter AND the honest
      // truncation marker with real counts plus the spill-file advice. The background path used to call
      // the filter alone, so a 400 KB build whose error was in the first 50 KB reached the model as
      // `[…truncated…]<tail>` — a bare ellipsis with no counts and nothing to read for the rest, which
      // the model has no way to distinguish from complete output. The FOREGROUND path has always been
      // honest here; this was the asymmetry.
      const bgSpillPath =
        finalOutput.length > SPILL_MIN_BYTES
          ? await spillFullOutput(finalOutput, `${toolCallId}-bg`)
          : null
      context?.asyncRegistry?.emitBackground(
        toolCallId,
        modelFacingOutput(finalOutput, { command, toolCallId, spillPath: bgSpillPath }),
        {
          exitCode: exitCode ?? -1,
          wallTimeMs,
          done: true,
          jobStatus,
          notify: input.notify,
          details: {
            command: command,
            cwd,
            isStreaming: false,
            isBackground: true,
            jobStatus,
            terminalId: proc.terminalId,
          },
        },
      )
      onUpdate?.({
        command: command,
        cwd,
        output: finalOutput,
        isStreaming: false,
        isBackground: true,
        jobStatus,
        exitCode: exitCode ?? -1,
        wallTimeMs,
        terminalId: proc.terminalId,
      })
    } finally {
      bgCleanup()
    }
  })()

  // Settle window: watch early output without blocking the job. A first banner
  // is not proof that startup succeeded — wrapper commands often print one and
  // fail a moment later (Tauri's BeforeDevCommand is one example). Keep the
  // call open for a short minimum grace period, then return on a quiet gap; an
  // actual exit still returns immediately and the hard cap keeps startup bounded.
  // An adopted job already spent its whole foreground budget waiting — far longer
  // than this window would — so watching for early output again would only delay
  // the answer the model is waiting for. Return with what the foreground captured.
  if (!adopted)
    await awaitBackgroundSettle(
      {
        exited: proc.exited,
        onChunk: (listener) => {
          chunkListeners.add(listener)
          return () => chunkListeners.delete(listener)
        },
        hasOutput: () => bgOutput() !== '',
        lastChunkAt: () => bgLastChunkAt,
      },
      {
        minMs: BACKGROUND_SETTLE_MIN_MS,
        maxMs: BACKGROUND_SETTLE_MAX_MS,
        quietMs: BACKGROUND_SETTLE_QUIET_MS,
      },
      startMs,
    )

  const earlyExited = bgDone || bgSettled
  const jobId = context?.asyncRegistry?.getBackgroundJobId?.(toolCallId) ?? toolCallId
  const content = renderBackgroundStartResult({
    command,
    jobId,
    output: bgOutput(),
    earlyExited,
    exitCode: bgExitCode,
    ...(adopted ? { adoptedAfterSecs: adopted.foregroundSecs } : {}),
    settleMaxMs: BACKGROUND_SETTLE_MAX_MS,
  })
  return { content, details: initialDetails }
}
