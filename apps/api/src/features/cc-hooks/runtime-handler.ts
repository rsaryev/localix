import type { CcHookEvent, CcHookHandler, CcHookInput, CcHookOutcome } from './contracts'
import type { CreateCcHooksRuntimeOptions } from './runtime-contracts'
import { executeHook, type HookEnv } from './executor'
import { executeHttpHook } from './http'
import { runMcpToolHook } from './mcp-tool-hook'
import { mapPromptOutcome } from './prompt-hook'
import { spendOnce } from './runtime-selection'
import { runHookOperation } from '../lifecycle-hooks/operation'

type HandlerRunnerOptions = Pick<
  CreateCcHooksRuntimeOptions,
  | 'projectDir'
  | 'logger'
  | 'evaluatePromptHook'
  | 'runAgentHook'
  | 'callMcpTool'
  | 'emitNotice'
  | 'onceKeys'
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
    const result = await runHookOperation({
      timeoutMs: h.timeoutMs,
      signal: signalFor(event),
      run: (signal) => runHandlerInner(event, h, input, addContextOnZero, signal),
    })
    if (result.kind !== 'completed') {
      logger.warn(`[cc-hooks] ${event} ${h.kind ?? 'command'} handler ${result.kind} — ignored`)
      return result.kind === 'aborted'
        ? {}
        : { failed: result.kind === 'timeout' ? 'timeout' : 'error' }
    }
    const outcome = result.value
    // A skill's `once` hook is spent by a run that neither failed nor blocked (exit 2).
    if (!outcome.failed && !outcome.blocked) spendOnce(onceKeys, event, h)
    // Surface a non-blocking `systemMessage` warning (CC: shown to the user in the
    // transcript). Fires for EVERY event, deduping identical consecutive messages.
    const notice = DISCARDS_SYSTEM_MESSAGE.has(event) ? undefined : outcome.systemMessage?.trim()
    if (emitNotice && notice && notice !== lastNotice) {
      lastNotice = notice
      try {
        emitNotice(notice, event)
      } catch (err) {
        logger.warn?.(`[cc-hooks] emitNotice failed: ${String(err)}`)
      }
    }
    return outcome
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
      }).catch(() => ({ ok: true })) // fail-open on any evaluator error
      return mapPromptOutcome(event, result)
    }
    if (h.kind === 'http') {
      return executeHttpHook(h, input, logger, addContextOnZero, signal)
    }
    if (h.kind === 'mcp_tool') {
      return runMcpToolHook(h, input, callMcpTool, addContextOnZero, logger, signal)
    }
    return executeHook(h, input, projectDir, logger, addContextOnZero, signal, envFor?.(event))
  }

  return runHandler
}
