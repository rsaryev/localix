import type { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'

export { isCatastrophic, isDangerous } from './bash-command-safety'
export { isReadOnlyCommand } from './bash-readonly-classify'
export { isFileDumpCommand, FILE_DUMP_HINT, FILE_WRITE_HINT } from './bash-shell-hints'
export { withTimeoutShim, withPythonShim, withCommandShims } from './bash-shims'
export {
  bashToolInputSchema,
  classifyBgExit,
  type BashToolInput,
  type BashJobStatus,
  type BashToolDetails,
  type BashToolOptions,
} from './bash-types'

import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'
import { withCommandShims } from './bash-shims'
import { classifyBashCall } from './bash-call-class'
import {
  bashInputSchemaFor,
  type BashToolDetails,
  type BashToolInput,
  type BashToolOptions,
} from './bash-types'
import { runBatchCommands, runForegroundCommand, resolveCwd, type BashRunContext } from './bash-run'
import { runBackgroundCommand } from './bash-background'
import { refuseAtJobCap } from './bash-promote'
import { runUntilWait } from './bash-until'
import { withMutationFlag } from './bash-shell-hints'
import { INTERACTIVE_ACTIONS, runTerminalAction, type TerminalDetails } from '../terminal/terminal'

export function createBashTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  options: BashToolOptions = {},
) {
  const allowBackground = options.allowBackground ?? true
  const spawnTerminalJob = options.spawnTerminalJob
  const terminalControl = options.terminalControl
  const fileTools = options.fileTools ?? { read: true, write: true }
  // The four schema variants differ only by which OPTIONAL keys they carry, so every
  // variant's parsed output is a valid BashToolInput — and this ANNOTATION (checked by
  // the compiler, unlike the `as` cast execute used to need) is what pins the tool's
  // public TInput to the full input type. Without it, TS collapses the conditional
  // return to its narrowest union member and `createBashTool()` advertises a tool with
  // no `background` field at all, which is a lie in every session that allows one.
  const inputSchema: z.ZodType<BashToolInput> = bashInputSchemaFor({
    background: allowBackground,
    terminal: terminalControl != null,
    wait: options.waitHost != null,
  })
  const interactiveActions = new Set<string>(INTERACTIVE_ACTIONS)
  const runCtx: BashRunContext = {
    env,
    defaultCwd,
    allowBackground,
    spawnTerminalJob,
    recordPreviewTarget: options.recordPreviewTarget,
    pluginBinDirs: options.pluginBinDirs,
    waitHost: options.waitHost,
  }
  // The WAIT rule (use `until`, never a sleep loop) is stated once, on the `until` field, which
  // is where the model is looking when it reaches for one. It used to be here, on the field,
  // in the `jobs` description and in the prompt — four copies billed on every request.
  const backgroundDescription = allowBackground
    ? [
        'Long-running processes (dev servers, watchers, long builds) need background:true — foreground kills them at `timeout`. The launch result carries their early output (the served URL, or the crash): read it instead of probing with curl/lsof/ps.',
      ]
    : [
        'Foreground only in this session: do not start dev servers, watchers or other long-running processes.',
      ]

  // TInput/TDetails stated, not inferred. bash really does return two detail shapes —
  // a command result, or an interactive-terminal screen when `action` dispatches to
  // runTerminalAction — and TS could only reconcile them as `{}`, so every typed
  // consumer saw a tool with no usable details at all. `action` is the discriminant.
  return defineAgentTool<BashToolInput, BashToolDetails | TerminalDetails>({
    name: TOOL.bash,
    label: 'Bash',
    activeVerb: 'Running',
    // Which tool to use INSTEAD of the shell for file work is the prompt's routing rule
    // ("# Execution discipline"), stated once there; this says what the shell is for.
    description: [
      'Run a shell command and stream its output (stdout+stderr merged; non-zero exit is an error). Use it to RUN things: scripts, installs, builds, git, tests.',
      ...backgroundDescription,
      ...(terminalControl
        ? ['Interactive programs (vim, REPLs, y/n prompts) use the PTY `action`s.']
        : []),
    ].join('\n'),
    inputSchema,
    executionMode: 'sequential',
    // Statically a writer (most commands are); `classifyBashCall` answers per call, so a
    // read-only command still runs in a session that refuses writes.
    mutates: true,
    classify: classifyBashCall,

    async execute(toolCallId, input, signal, onUpdate, context) {
      // Interactive-terminal actions (open/screen/keys/type/list/close) — drive a
      // full-screen TUI in a PTY. Dispatched before the command path; plain
      // commands leave `action` unset.
      if (input.action && interactiveActions.has(input.action)) {
        if (!terminalControl) {
          return {
            content: 'Interactive terminal actions are not available in this session.',
            isError: true,
          }
        }
        // An opened pane is recorded as the session's work (`terminal/terminal-work.ts`), so it
        // holds a slot of the same cap a background job does.
        const refused = input.action === 'open' ? refuseAtJobCap(context) : null
        if (refused) return refused
        return runTerminalAction(
          terminalControl,
          {
            action: input.action,
            command: input.command,
            cwd: input.cwd,
            terminal_id: input.terminal_id,
            keys: input.keys,
            text: input.text,
            wait_for: input.wait_for,
            wait_absent: input.wait_absent,
            wait_timeout_ms: input.wait_timeout_ms,
          },
          signal,
        )
      }

      // ── Batch mode: several commands run sequentially in ONE call ─────────
      if (input.commands && input.commands.length > 0) {
        return withMutationFlag(
          input.commands,
          runBatchCommands(runCtx, toolCallId, input, signal, onUpdate, context),
          fileTools,
        )
      }

      if (!input.command) {
        return {
          content: 'Provide `command` for a single command, or `commands` for a sequential batch.',
          isError: true,
        }
      }

      // `until` is a background job by construction: the poll outlives the call.
      const background = input.background || input.until !== undefined

      if (background && !allowBackground) {
        return { content: 'background mode is disabled in sub sessions', isError: true }
      }

      // Background mode is only supported for the local backend
      if (background && env.config.kind !== 'local') {
        return {
          content: `background mode is not supported for backend=${env.config.kind}`,
          isError: true,
        }
      }

      const cwd = resolveCwd(input, defaultCwd)
      // Background tasks run until they complete naturally or are stopped — a
      // small model-supplied timeout must NOT kill them (the classic footgun:
      // `npm run dev` backgrounded with timeout:10 dies after 10s). Background
      // ignores any timeout below 60s and treats 0 as "no limit"; foreground
      // honors the model's value or defaults to 60s.
      const timeoutSecs = background
        ? input.timeout && input.timeout >= 60
          ? input.timeout
          : 0
        : (input.timeout ?? 60)
      // Executed string may carry the `timeout` shim; the model-facing/displayed
      // command stays the original (input.command) everywhere.
      const execCommand = withCommandShims(input.command)
      const startMs = Date.now()

      // Permission checks (workspace boundary, dangerous commands) are enforced
      // centrally by the permission engine via the loop's beforeToolCall.

      if (input.until !== undefined) {
        if (!runCtx.waitHost) {
          return { content: '`until` waits are not available in this session.', isError: true }
        }
        return runUntilWait(
          {
            host: runCtx.waitHost,
            ...(runCtx.pluginBinDirs ? { pathPrefix: runCtx.pluginBinDirs } : {}),
          },
          toolCallId,
          input,
          cwd,
          timeoutSecs,
          onUpdate,
          context,
        )
      }

      if (input.background) {
        const refused = refuseAtJobCap(context)
        if (refused) return refused
        return runBackgroundCommand(
          runCtx,
          toolCallId,
          input,
          cwd,
          execCommand,
          timeoutSecs,
          startMs,
          signal,
          onUpdate,
          context,
        )
      }

      return withMutationFlag(
        [input.command],
        runForegroundCommand(
          runCtx,
          toolCallId,
          input,
          cwd,
          execCommand,
          timeoutSecs,
          startMs,
          signal,
          onUpdate,
          context,
        ),
        fileTools,
      )
    },
  })
}
