/**
 * `bash` with `until`: the same command, POLLED instead of run once, and the session woken
 * when it exits 0. This is the event-driven wait — the shell loop the model would otherwise
 * write (`while ! curl …; do sleep 5; done`) burns the turn and dies at the timeout; a wait
 * lives outside the conversation and comes back WITH the news.
 *
 * The tool owns nothing about waiting. Interval, deadline, the not-runnable check and the wake
 * all belong to `features/monitors` behind the injected host; this file only translates a bash
 * call into a spec and puts the wait where background jobs live, so `jobs list/read/stop`, the
 * composer's work row and the card's Stop button work without a second surface.
 */
import type { AgentToolExecutionContext, AgentToolResult } from '@localixai/agent/agents'

import type { MonitorEndReason, MonitorEvent, MonitorSpec } from '../../../monitors/contracts'
import {
  MONITOR_DEFAULT_TIMEOUT_MS,
  MONITOR_MAX_TIMEOUT_MS,
  MONITOR_MIN_INTERVAL_SECONDS,
  monitorEndPhrase,
} from '../../../monitors/contracts'

/** How many polls must fit before the deadline; the interval is clamped to guarantee it. */
const MIN_POLLS_BEFORE_DEADLINE = 4
import type { BashJobStatus, BashToolDetails, BashToolInput } from './bash-types'

/** What the host must be able to do. Bound to one user + session by the caller. */
export interface BashWaitHost {
  /**
   * Async because a command may reference vault keys (`${secret:KEY}`) the host resolves
   * before anything is spawned — and refuses to start over, rather than polling with an
   * empty credential.
   */
  start(
    /** The call whose card shows the wait — and the name its work record goes by. */
    toolCallId: string,
    spec: MonitorSpec,
    hooks?: {
      onEvents?: (events: MonitorEvent[]) => void
      onEnd?: (reason: MonitorEndReason, detail: string | undefined) => void
    },
  ): Promise<{ ok: true; id: string; label: string } | { ok: false; error: string }>
  stop(waitId: string): boolean
}

export interface UntilWaitContext {
  host: BashWaitHost
  pathPrefix?: string[]
}

function commandLabel(command: string): string {
  const [first = ''] = command.trim().split('\n')
  return first.length > 120 ? `${first.slice(0, 120)}…` : first
}

export async function runUntilWait(
  wait: UntilWaitContext,
  toolCallId: string,
  input: BashToolInput,
  cwd: string,
  /** Background timeout already normalized by the caller: 0 = the engine's default deadline. */
  timeoutSecs: number,
  onUpdate: ((details: BashToolDetails) => void) | undefined,
  context: AgentToolExecutionContext | undefined,
): Promise<AgentToolResult<BashToolDetails>> {
  const command = input.command!
  const timeoutMs =
    timeoutSecs > 0
      ? Math.min(timeoutSecs * 1000, MONITOR_MAX_TIMEOUT_MS)
      : MONITOR_DEFAULT_TIMEOUT_MS
  // A model that mirrors the deadline into the interval (`until: 300, timeout: 300`) has
  // written a wait that can only ever time out. Live-observed on the first run; the interval
  // is clamped so several polls fit before the deadline, and the result says so.
  const maxInterval = Math.max(
    MONITOR_MIN_INTERVAL_SECONDS,
    Math.floor(timeoutMs / 1000 / MIN_POLLS_BEFORE_DEADLINE),
  )
  const everySeconds = Math.min(input.until!, maxInterval)
  const spec: MonitorSpec = {
    // The description heads every wake; a multi-line script there buries the news under it.
    description: input.description?.trim() || commandLabel(command),
    cwd,
    until: { check: command, everySeconds, when: { kind: 'exit_zero' }, emit: 'once' },
    timeoutMs,
    ...(wait.pathPrefix ? { pathPrefix: wait.pathPrefix } : {}),
  }

  const details: BashToolDetails = {
    command,
    cwd,
    output: '',
    isStreaming: true,
    isBackground: true,
    background: 'requested',
    jobStatus: 'running',
  }

  // Both bindings are declared BEFORE `start` and filled after: a source can produce an
  // event or fail immediately, and a `const` read from inside the hooks would throw.
  let log = ''
  let disposeActions: (() => void) | undefined
  const started = await wait.host.start(toolCallId, spec, {
    onEvents: (events) => {
      log += `${events.map((event) => event.text).join('\n')}\n`
      context?.asyncRegistry?.emitBackground(toolCallId, log, {
        details: { ...details, output: log },
      })
    },
    onEnd: (reason, detail) => {
      log += `[wait ended: ${monitorEndPhrase(reason)}${detail ? ` — ${detail}` : ''}]\n`
      // Only a met condition is a SUCCESS of the wait: a timeout, a kill or a broken check
      // must not draw a green tick for a command that never exited 0.
      const jobStatus: BashJobStatus =
        reason === 'condition-met'
          ? 'completed'
          : reason === 'killed' || reason === 'timeout'
            ? reason
            : 'failed'
      context?.asyncRegistry?.emitBackground(toolCallId, log, {
        done: true,
        exitCode: jobStatus === 'completed' ? 0 : 1,
        jobStatus,
        details: { ...details, output: log, isStreaming: false, jobStatus },
      })
      disposeActions?.()
    },
  })
  if (!started.ok) return { content: started.error, isError: true }

  // Registering `kill` under the wait's OWN id makes it a first-class job: `jobs` lists,
  // reads and stops it, and the card's Stop button drives the same path as the strip's.
  disposeActions = context?.asyncRegistry?.registerActions(
    toolCallId,
    {
      kill: {
        label: 'Stop',
        icon: 'square',
        execute: () => {
          wait.host.stop(started.id)
        },
      },
    },
    { label: started.label, jobId: started.id, kind: 'monitor' },
  )

  onUpdate?.(details)
  const deadlineSecs = Math.round(timeoutMs / 1000)
  const clamped =
    everySeconds !== input.until
      ? ` (interval lowered from ${input.until}s so several polls fit before the deadline)`
      : ''
  return {
    content: [
      `Wait ${started.id} started · ${spec.description}`,
      `Running the command every ${everySeconds}s${clamped} until it exits 0; gives up after ${deadlineSecs}s and tells you.`,
      `END YOUR TURN now — you will be woken with the result. Stop it with jobs action="stop" job_id="${started.id}" when it is no longer useful.`,
    ].join('\n'),
    details,
  }
}
