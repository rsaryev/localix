/**
 * Host wiring for the `Jobs` tool — the model's only handle on the background work it launched
 * (list / stop / send_input / read scrollback).
 *
 * Every accessor goes through the work registry's owner filter (`work.list` / `work.resolve`),
 * and none reads the index directly. This module used to repeat the filter inline in each
 * accessor, and the one that forgot it (`readJob`) returned another session's scrollback for an
 * id that resolved there.
 */
import type { AgentTool } from '@localixai/agent/agents'
import { createJobsTool, stopJob, type JobsToolDeps } from '../../../agent-core/tools/bash/jobs'
import type { RuntimeState } from '../agent-runner-state'
import type { RunnerDeps } from '../agent-runner-types'

interface JobsHostInput {
  deps: RunnerDeps
  work: RuntimeState['work']
  userId: string
  sessionId: string
  /** Whether bash's interactive actions survive this run's tool policy. */
  terminalInput?: boolean
  runAction: (toolCallId: string, action: string, payload?: unknown) => boolean
}

export function buildJobsTool(input: JobsHostInput): AgentTool {
  return createJobsTool(jobsHost(input), {
    terminalInput: input.terminalInput ?? input.deps.terminalControl != null,
  })
}

/** `TaskStop`'s half for background jobs: this session's own, through the same owner filter. */
export function buildStopJob(input: JobsHostInput) {
  const host = jobsHost(input)
  return async (jobId: string) => stopJob(host, jobId)
}

function jobsHost(input: JobsHostInput): JobsToolDeps {
  const { deps, work, userId, sessionId, runAction } = input
  const owner = { userId, sessionId }
  // A pane recorded by its PTY (`terminal/terminal-work.ts`: the agent's interactive terminal, a
  // server the preview restarted) registered no action, so `runAction` finds nothing and `jobs
  // stop` refused work the prompt had just listed as stoppable. It is stopped and typed into
  // through the terminal itself, behind the same session-scoped port the `Bash` tool uses.
  const runOnPane = (
    record: { terminalId: string | null } | undefined,
    action: 'kill' | 'send_input',
    payload: unknown,
  ): boolean => {
    const terminalId = record?.terminalId
    const control = deps.terminalControl
    if (!terminalId || !control) return false
    if (action === 'kill') return control.close({ userId, sessionId, terminalId })
    const text = (payload as { text?: string } | undefined)?.text
    return text ? control.write({ userId, sessionId, terminalId, data: text }) : false
  }
  return {
    listJobs: () =>
      work.list(owner).map((record) => ({
        toolCallId: record.toolCallId,
        jobId: record.displayId,
        command: record.label,
        startedAt: Date.parse(record.startedAt),
        ...(record.terminalId ? { terminalId: record.terminalId } : {}),
      })),
    resolveJobId: (jobId) => work.resolve(owner, jobId)?.toolCallId ?? null,
    runAction: (toolCallId, action, payload) => {
      // A monitor stops through its service, not an action its tool registered: a wait resumed
      // after a restart is running work whose starting call no longer lives in this process.
      const record = work.resolve(owner, toolCallId)
      if (record?.kind === 'monitor' && action === 'kill' && deps.monitors)
        return deps.monitors.stop(userId, sessionId, record.displayId)
      // Tagged so the job's end reads "stopped by the agent" — and so its own stop does not
      // come back to the agent as a mid-run "your job ended" reminder it already knows.
      const actionPayload =
        action === 'kill' ? { ...(payload as object | undefined), by: 'agent' } : payload
      const ok = runAction(toolCallId, action, actionPayload) || runOnPane(record, action, payload)
      const terminalId = record?.terminalId
      if (ok && action === 'send_input' && terminalId) {
        deps.streamRegistry.publish(userId, sessionId, {
          type: 'terminal.input',
          sessionId,
          terminalId,
          source: 'agent',
          // Literal stdin can contain credentials. Publish activity, never bytes.
          label: 'text',
        })
      }
      return ok
    },
    // Read a job's current output: a monitor's event log, or a PTY job's scrollback.
    readJob: (toolCallId) => {
      const record = work.resolve(owner, toolCallId)
      if (!record) return null
      // A MONITOR has no PTY and never will: its "output" is the events it decided were worth a
      // wake, which the monitor service keeps in a bounded log — and the wake text tells the
      // agent to read it.
      if (record.kind === 'monitor' && deps.monitors) {
        const events = deps.monitors.read(userId, sessionId, record.displayId)
        if (events) return { output: events.text, running: true }
      }
      if (!record.terminalId || !deps.readTerminalJob) return null
      return deps.readTerminalJob({ userId, terminalId: record.terminalId })
    },
    now: () => Date.now(),
  }
}
