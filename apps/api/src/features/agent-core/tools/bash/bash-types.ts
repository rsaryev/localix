import { z } from 'zod'
import { stringToArray } from '../tool-schema'

import { isTerminationSignalExit } from '../../../../lib/process-exit'
import type { ConfirmToolRequest, ConfirmToolResponse } from '../hitl/confirm'
import type { SpawnTerminalJob } from '../terminal/terminal-job'
import { MONITOR_MIN_INTERVAL_SECONDS } from './monitor-wait'
import type { BashWaitHost } from './bash-until'
import { terminalActionFields, type TerminalToolDeps } from '../terminal/terminal'
import type { BackgroundSettleWindow } from './bash-run-context'

export const bashToolInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .optional()
    .describe('Shell command to run. Omit when using `commands`.'),
  commands: z
    .preprocess(stringToArray, z.array(z.string().min(1)).min(1))
    .optional()
    .describe(
      'Independent commands in ONE foreground call, each in a fresh shell (chain dependent steps with && in one entry); stops at the first failure unless `keep_going`.',
    ),
  keep_going: z.boolean().optional().describe('commands: continue past a failure.'),
  cwd: z.string().optional().describe('Working directory (defaults to the session root).'),
  // Interactive-terminal actions (vim/REPLs/menus). Omit `action` to run a command.
  ...terminalActionFields,
  timeout: z
    .number()
    .int()
    .min(1)
    .max(600)
    .optional()
    .describe(
      'Seconds (default 60, max 600) for a foreground command or an `until` wait. A background job ignores it and runs until it exits or is stopped.',
    ),
  background: z
    .boolean()
    .optional()
    .describe('Return a job id at once; the output streams live and arrives on a later turn.'),
  notify: z
    .boolean()
    .optional()
    .describe('background: wake the agent with the output when the job finishes.'),
  until: z
    .number()
    .int()
    .min(MONITOR_MIN_INTERVAL_SECONDS)
    .optional()
    .describe(
      'Shell condition wait (omit action); PTY screen changes use action="wait" instead. Re-run command every N seconds (5 local, 30 remote/CI) until exit 0, then wake the agent — end your turn meanwhile. Check error states too. timeout (default 300) is the deadline; never write sleep/retry loops.',
    ),
})

/**
 * The model no longer generates a description label. Keep the optional legacy field only
 * for in-process callers and older transcripts; it is absent from the model-facing schema.
 */
export type BashToolInput = z.infer<typeof bashToolInputSchema> & {
  description?: string
}

export const foregroundBashToolInputSchema = bashToolInputSchema
  .omit({ background: true, notify: true, until: true })
  .extend({
    timeout: z
      .number()
      .int()
      .min(1)
      .max(600)
      .optional()
      .describe('Timeout in seconds (default 60, max 600).'),
  })

/** The interactive-PTY fields contributed by {@link terminalActionFields}. */
const TERMINAL_ACTION_KEYS = {
  action: true,
  terminal_id: true,
  keys: true,
  text: true,
  wait_for: true,
  wait_absent: true,
  wait_for_exit: true,
  wait_timeout_ms: true,
} as const

/**
 * Pick the input schema matching what this session's bash tool can actually do.
 *
 * Both the description prose and `execute` already gate the interactive-terminal
 * actions on a host `terminalControl`; the SCHEMA used to advertise them
 * unconditionally. That is the capability-overclaim shape: ~340 tokens of schema
 * on every single call describing actions the tool answers with "not available in
 * this session", and a weak model reading the schema rather than the prose will
 * spend a turn discovering that.
 */
export function bashInputSchemaFor(opts: {
  background: boolean
  terminal: boolean
  /** A wait host is wired. Without one `until` answers "not available", so it is not offered. */
  wait?: boolean
}) {
  const base = !opts.background
    ? foregroundBashToolInputSchema
    : opts.wait === false
      ? bashToolInputSchema.omit({ until: true })
      : bashToolInputSchema
  return opts.terminal ? base : base.omit(TERMINAL_ACTION_KEYS)
}

const MAX_TIMEOUT_SECONDS = 600

/**
 * The runtime's pre-validation hook. `timeout` is seconds while `wait_timeout_ms` beside it is
 * milliseconds, and models carry the millisecond habit over: LOCALIX-170 sent `timeout: 120000`
 * for two minutes and was refused. A whole number of seconds written in milliseconds that fits
 * the cap has one reading; anything else is left for the schema to refuse.
 *
 * A string `description` is Claude Code's Bash label, which models trained on it still send
 * (twelve recorded calls). It carries nothing the command needs, so it is dropped rather than
 * failing the call on a field the schema no longer shows.
 */
export function prepareBashArguments(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  let input = raw as Record<string, unknown>
  if (typeof input.description === 'string') {
    const { description: _label, ...rest } = input
    input = rest
  }
  const timeout = input.timeout
  if (typeof timeout !== 'number' || timeout <= MAX_TIMEOUT_SECONDS || timeout % 1000 !== 0)
    return input
  const seconds = timeout / 1000
  return seconds >= 1 && seconds <= MAX_TIMEOUT_SECONDS ? { ...input, timeout: seconds } : input
}

export type BashJobStatus = 'running' | 'completed' | 'failed' | 'killed' | 'timeout'

/**
 * Classify a finished background job. A signal-terminated job (not via our own
 * kill/timeout path — e.g. dev hot-reload, an external ^C) must read as `killed`
 * (→ aborted/stopped downstream), NOT `failed`; otherwise every watch-mode reload
 * marks healthy background jobs failed. See [worker-stopped-is-hot-reload].
 */
export function classifyBgExit(opts: {
  byUser: boolean
  byTimeout: boolean
  exitCode: number | null
}): BashJobStatus {
  if (opts.byUser) return 'killed'
  if (opts.byTimeout) return 'timeout'
  if (opts.exitCode === 0) return 'completed'
  if (isTerminationSignalExit(opts.exitCode)) return 'killed'
  return 'failed'
}

export interface BashToolDetails {
  command: string
  cwd: string
  output: string
  isStreaming: boolean
  exitCode?: number
  wallTimeMs?: number
  isBackground?: boolean
  /**
   * WHY this is a background job, when it is one. `'requested'` — the call asked for
   * it. `'promoted'` — a foreground command outran its timeout and was handed to the
   * background instead of being killed, so the model can tell "I chose this" from
   * "this outlived its budget" and knows the job id is worth polling.
   */
  background?: 'requested' | 'promoted'
  jobStatus?: BashJobStatus
  /** When a background job runs in a PTY pane, the backend terminal id the UI attaches to. */
  terminalId?: string
  request?: ConfirmToolRequest
  response?: ConfirmToolResponse
}

export interface BashToolOptions {
  allowBackground?: boolean
  /**
   * When provided, background jobs run in a real PTY pane (the user can watch +
   * interact) via this host instead of a detached child process. Injected at
   * wiring time, already bound to the user + session. Absent → child_process.
   */
  spawnTerminalJob?: SpawnTerminalJob
  /**
   * Enables the interactive-terminal actions (open/screen/keys/type/list/close):
   * driving full-screen TUIs in a PTY with a rendered screen + named keys. Bound
   * to the user + session at wiring time. Absent → those actions report unavailable.
   */
  terminalControl?: TerminalToolDeps
  /**
   * Enabled plugins' `bin/` directories, appended to PATH for bash subprocesses
   * so bundled plugin CLIs resolve by bare name (see {@link BashRunContext}).
   */
  pluginBinDirs?: string[]
  /**
   * Shell files sourced before every command, when they exist: the session's Claude Code
   * `CLAUDE_ENV_FILE`s, whose exports persist into later commands. Absent in tests.
   */
  envScripts?: string[]
  /**
   * The engine behind `until`: polls the command and wakes the session when it exits 0.
   * Bound to user + session at wiring time. Absent → `until` reports unavailable.
   */
  waitHost?: BashWaitHost
  /**
   * The background settle window. Production keeps the default (2–3 s); a test that is not
   * about the window passes a short one instead of sleeping it on every spawn.
   */
  backgroundSettle?: BackgroundSettleWindow
}
