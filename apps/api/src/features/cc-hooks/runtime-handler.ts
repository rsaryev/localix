import type { CcHookEvent, CcHookHandler, CcHookInput, CcHookOutcome } from './contracts'
import type { CreateCcHooksRuntimeOptions } from './runtime-contracts'
import { executeHook, type HookEnv } from './executor'
import { executeHttpHook } from './http'
import { runMcpToolHook } from './mcp-tool-hook'
import { mapPromptOutcome } from './prompt-hook'
import { spendOnce } from './runtime-selection'
import { refreshTranscriptFor } from './transcript'
import { runHookOperation } from '../lifecycle-hooks/operation'
import { blockOnFailure } from './on-failure'
import { capHookOutput } from './output-cap'
import { hookErrorNotice } from './hook-error-notices'
import { dirname, join } from 'node:path'

type HandlerRunnerOptions = Pick<
  CreateCcHooksRuntimeOptions,
  | 'projectDir'
  | 'logger'
  | 'evaluatePromptHook'
  | 'runAgentHook'
  | 'callMcpTool'
  | 'emitNotice'
  | 'onHookStatus'
  | 'onceKeys'
  | 'transcript'
> & {
  signalFor: (event: CcHookEvent) => AbortSignal | undefined
  /** What an event adds to a command hook's environment (`CLAUDE_ENV_FILE`). */
  envFor?: (event: CcHookEvent) => HookEnv | undefined
}

/** Added events whose `systemMessage` CC discards; the earlier events keep today's notices. */
const DISCARDS_SYSTEM_MESSAGE: ReadonlySet<CcHookEvent> = new Set([
  'InstructionsLoaded',
  'ConfigChange',
  'PostCompact',
  'StopFailure',
  'Elicitation',
  'ElicitationResult',
  'MessageDisplay',
  'WorktreeCreate',
])

/** Bound handler capabilities and notice state for one runtime. */
export function createHookHandlerRunner(options: HandlerRunnerOptions) {
  const {
    projectDir,
    logger,
    evaluatePromptHook,
    runAgentHook,
    callMcpTool,
    emitNotice,
    signalFor,
    envFor,
    onceKeys,
  } = options
  // Last non-blocking `systemMessage` surfaced this run — used to drop identical
  // consecutive warnings (e.g. one hook that fires on every tool call).
  let lastNotice: string | undefined
  /**
   * Execute ONE handler and fold it to an outcome, dispatching by handler kind.
   * All five types share the fold layer:
   *   - `prompt`/`agent` run an injected `{ok,reason}` evaluator → `mapPromptOutcome`;
   *   - `http`/`mcp_tool` run their fetch/MCP call → command-stdout output schema;
   *   - `command` spawns the shell hook.
   * Every non-command evaluator fails open (`{}` / `{ok:true}`) when its injected
   * capability is absent or throws. `addContextOnZero` gates plain-text-as-context
   * (SessionStart / UserPromptSubmit) for the stdout-dialect types.
   */
  async function runHandler(
    event: CcHookEvent,
    h: CcHookHandler,
    input: CcHookInput,
    addContextOnZero: boolean,
  ): Promise<CcHookOutcome> {
    await refreshTranscriptFor(options.transcript, [h], input)
    if (h.statusMessage) options.onHookStatus?.(h.statusMessage, true)
    const result = await runHookOperation({
      timeoutMs: h.timeoutMs,
      signal: signalFor(event),
      run: (signal) => runHandlerInner(event, h, input, addContextOnZero, signal),
    }).finally(() => {
      if (h.statusMessage) options.onHookStatus?.(h.statusMessage, false)
    })
    if (result.kind !== 'completed') {
      logger.warn(`[cc-hooks] ${event} ${h.kind ?? 'command'} handler ${result.kind} — ignored`)
      if (result.kind === 'aborted') return {}
      const failed: CcHookOutcome = { failed: result.kind === 'timeout' ? 'timeout' : 'error' }
      const notice = hookErrorNotice(event, h, input, failed)
      if (notice) emitSafely(notice, event)
      return blockOnFailure(event, h, failed)
    }
    // `defer` needs a headless caller to resume the call, and Localix has none: Claude Code
    // "logs a warning and ignores the hook result" in an interactive session (hooks.md).
    if (result.value.permissionDecision === 'defer') {
      logger.warn(
        `[cc-hooks] ${event} hook answered "defer", which only a headless run honors — ignored`,
      )
      return {}
    }
    // Strings past 10,000 characters go to a file beside the session's transcript.
    const outcome = capHookOutput(
      blockOnFailure(event, h, result.value),
      ...(options.transcript ? [join(dirname(options.transcript.path), 'hook-output')] : []),
    )
    // A skill's `once` hook is spent by a run that neither failed nor blocked (exit 2).
    if (!outcome.failed && !outcome.blocked) spendOnce(onceKeys, event, h)
    // A non-blocking error, or an observe-only event's exit-2 stderr, is a `hook error` notice.
    const errorNotice = hookErrorNotice(event, h, input, outcome)
    if (emitNotice && errorNotice) emitSafely(errorNotice, event)
    // Surface a non-blocking `systemMessage` warning (CC: shown to the user in the
    // transcript). Fires for EVERY event, deduping identical consecutive messages.
    const notice = DISCARDS_SYSTEM_MESSAGE.has(event) ? undefined : outcome.systemMessage?.trim()
    if (emitNotice && notice && notice !== lastNotice) {
      lastNotice = notice
      emitSafely(notice, event)
    }
    return outcome
  }

  function emitSafely(message: string, event: CcHookEvent): void {
    try {
      emitNotice?.(message, event)
    } catch (err) {
      logger.warn?.(`[cc-hooks] emitNotice failed: ${String(err)}`)
    }
  }

  async function runHandlerInner(
    event: CcHookEvent,
    h: CcHookHandler,
    input: CcHookInput,
    addContextOnZero: boolean,
    signal: AbortSignal,
  ): Promise<CcHookOutcome> {
    if (h.kind === 'prompt' || h.kind === 'agent') {
      const evaluate = h.kind === 'agent' ? runAgentHook : evaluatePromptHook
      if (!evaluate || !h.prompt) return {}
      const result = await evaluate({
        prompt: h.prompt,
        inputJson: JSON.stringify(input),
        model: h.promptModel,
        timeoutMs: h.timeoutMs,
        signal,
        ...(h.kind === 'agent' && h.agentMaxTurns ? { maxTurns: h.agentMaxTurns } : {}),
      }).catch((err: unknown) => ({ ok: true, failed: `the evaluator threw: ${String(err)}` }))
      return mapPromptOutcome(event, result, {
        agent: h.kind === 'agent',
        continueOnBlock: h.continueOnBlock,
      })
    }
    if (h.kind === 'http') {
      return executeHttpHook(h, input, logger, addContextOnZero, signal)
    }
    if (h.kind === 'mcp_tool') {
      // No MCP server is up when a session starts or resumes (hooks.md, MCP tool hook fields).
      const launch = 'source' in input && (input.source === 'startup' || input.source === 'resume')
      if (event === 'SessionStart' && launch) {
        logger.info?.(`[cc-hooks] mcp_tool hooks are not available for SessionStart at launch`)
        return {}
      }
      return runMcpToolHook(h, input, callMcpTool, addContextOnZero, logger, signal)
    }
    return executeHook(h, input, projectDir, logger, addContextOnZero, signal, envFor?.(event))
  }

  return runHandler
}
