/**
 * Per-run CC hook orchestration — the surface the runtime dispatch points call.
 *
 * A {@link CcHooksRuntime} is built once per agent run from the merged registry.
 * Each `run<Event>` method gathers the handlers whose matcher matches, applies
 * per-handler `if` guards + `once` de-dup, fires `async`/`asyncRewake` handlers
 * in the background, executes the SYNC handlers (in source order, rewrites
 * composing), and folds their outcomes into the shape that dispatch point needs.
 * When the feature is disabled (kill switch) or no handler matches, every method
 * is a cheap no-op.
 *
 * `Notification` fires when the agent needs the user (a HITL ask/quiz/confirm
 * surfaces) — CC's "agent needs input / permission prompt" notification. It is
 * observer-only (no output / no decision control, per the CC spec) and matches on
 * `notification_type`. Idle-notifications are intentionally NOT wired: the server
 * has no idle concept (a run either streams or ends).
 *
 * Layer: api feature module. No chat/UI imports.
 */
import type { CcHookEvent, CcHookHandler, CcHookInput, CcHookOutcome } from './contracts'
import { executeHook, executeHookInBackground } from './executor'
import { executeHttpHook } from './http'
import { runMcpToolHook } from './mcp-tool-hook'
import { matchesField, matchesToolName } from './matcher'
import { mapPromptOutcome } from './prompt-hook'
import { runHookOperation } from '../lifecycle-hooks/operation'
import type {
  CcHooksRuntime,
  CreateCcHooksRuntimeOptions,
  PreToolUseResult,
} from './runtime-contracts'
import { EMPTY_RUNTIME, joinContext, contextFrom, blockedFrom } from './runtime-results'
import { createHookSelector, type SelectOptions } from './runtime-selection'

export type {
  PreToolUseResult,
  PromptSubmitResult,
  StopResult,
  PreCompactResult,
  CcHooksRuntime,
  CreateCcHooksRuntimeOptions,
} from './runtime-contracts'

export function createCcHooksRuntime(opts: CreateCcHooksRuntimeOptions): CcHooksRuntime {
  const {
    registry,
    sessionId,
    projectDir,
    enabled,
    logger,
    rewake,
    onceKeys,
    evaluatePromptHook,
    runAgentHook,
    callMcpTool,
    emitNotice,
    signal: runSignal,
  } = opts
  const hasAny = Object.values(registry).some((groups) => groups && groups.length > 0)
  if (!enabled || !hasAny) return EMPTY_RUNTIME

  // Last non-blocking `systemMessage` surfaced this run — used to drop identical
  // consecutive warnings (e.g. one hook that fires on every tool call).
  let lastNotice: string | undefined
  // Teardown has its own bounded lifetime: cancelling a turn must not skip cleanup hooks.
  const signalFor = (event: CcHookEvent) => (event === 'SessionEnd' ? undefined : runSignal)

  const baseInput = <E extends CcHookEvent>(event: E) => ({
    session_id: sessionId,
    transcript_path: '',
    cwd: projectDir,
    hook_event_name: event,
  })

  const select = createHookSelector({ registry, sessionId, logger, onceKeys, signalFor })

  /** Fire background (`async`) handlers — never awaited, never affect the decision. */
  function fireAsync(handlers: CcHookHandler[], input: CcHookInput): void {
    for (const h of handlers)
      executeHookInBackground(
        h,
        input,
        projectDir,
        logger,
        rewake,
        signalFor(input.hook_event_name),
      )
  }

  /**
   * Run a whole event whose handlers all see the SAME input and where no outcome
   * can cut the chain short: fire the background handlers, execute the sync ones in
   * source order, hand back their outcomes for the caller to fold. An inert event
   * yields no outcomes, which every fold reads as "nothing to say".
   *
   * The three events that do NOT fit — UserPromptSubmit (stops at the first block),
   * PreToolUse and PostToolUse (each handler sees the previous one's rewrite) — drive
   * `select` + `fireAsync` + `runHandler` directly rather than bending this contract.
   */
  async function runAll(
    event: CcHookEvent,
    matchFn: (matcher: string | undefined) => boolean,
    input: CcHookInput,
    addContextOnZero: boolean,
    opts?: SelectOptions,
  ): Promise<CcHookOutcome[]> {
    const selected = select(event, matchFn, opts)
    if (!selected) return []
    fireAsync(selected.async, input)
    const outcomes: CcHookOutcome[] = []
    for (const h of selected.sync)
      outcomes.push(await runHandler(event, h, input, addContextOnZero))
    return outcomes
  }

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
      return {}
    }
    const outcome = result.value
    // Surface a non-blocking `systemMessage` warning (CC: shown to the user in the
    // transcript). Fires for EVERY event, deduping identical consecutive messages.
    const notice = outcome.systemMessage?.trim()
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
    return executeHook(h, input, projectDir, logger, addContextOnZero, signal)
  }

  return {
    active: true,

    async runSessionStart(source = 'startup') {
      const input: CcHookInput = { ...baseInput('SessionStart'), source }
      const additionalContext = contextFrom(
        await runAll('SessionStart', (m) => matchesField(m, source), input, true),
      )
      return additionalContext ? { additionalContext } : {}
    },

    async runUserPromptSubmit(prompt: string) {
      // Stops at the first blocking handler — so it drives the dispatch itself.
      const selected = select('UserPromptSubmit', () => true)
      if (!selected) return { blocked: false }
      const input: CcHookInput = { ...baseInput('UserPromptSubmit'), prompt }
      fireAsync(selected.async, input)
      const contexts: (string | undefined)[] = []
      for (const h of selected.sync) {
        const o = await runHandler('UserPromptSubmit', h, input, true)
        if (o.blocked || o.decision === 'block' || o.continue === false) {
          return {
            blocked: true,
            reason: o.blockReason || o.reason || o.stopReason || 'Prompt blocked by hook',
          }
        }
        contexts.push(o.additionalContext)
      }
      return { blocked: false, additionalContext: joinContext(contexts) }
    },

    async runPreToolUse(toolName: string, input: unknown, toolUseId?: string) {
      // Each handler sees the previous one's rewrite, and a deny cuts the chain —
      // neither fits `runAll`'s one-input/run-them-all contract.
      const selected = select('PreToolUse', (m) => matchesToolName(m, toolName), {
        ifCtx: { toolName, toolInput: input },
      })
      if (!selected) return { decision: 'proceed', didRewrite: false }
      const inputFor = (toolInput: unknown): CcHookInput => ({
        ...baseInput('PreToolUse'),
        tool_name: toolName,
        tool_input: toolInput,
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      })
      // async PreToolUse hooks can't block (fire against the pre-rewrite input).
      fireAsync(selected.async, inputFor(input))
      let effectiveInput = input
      let didRewrite = false
      let decision: PreToolUseResult['decision'] = 'proceed'
      for (const h of selected.sync) {
        const o = await runHandler('PreToolUse', h, inputFor(effectiveInput), false)
        if (
          o.blocked ||
          o.decision === 'block' ||
          o.continue === false ||
          o.permissionDecision === 'deny'
        ) {
          return {
            decision: 'deny',
            reason:
              o.blockReason ||
              o.permissionDecisionReason ||
              o.reason ||
              o.stopReason ||
              'Tool call denied by hook',
            didRewrite,
            ...(didRewrite ? { updatedInput: effectiveInput } : {}),
          }
        }
        if ('updatedInput' in o && o.updatedInput !== undefined) {
          effectiveInput = o.updatedInput
          didRewrite = true
        }
        // allow beats ask beats proceed (deny already returned above).
        if (o.permissionDecision === 'allow') decision = 'allow'
        else if (o.permissionDecision === 'ask' && decision !== 'allow') decision = 'ask'
      }
      return { decision, didRewrite, ...(didRewrite ? { updatedInput: effectiveInput } : {}) }
    },

    async runPostToolUse(
      toolName: string,
      input: unknown,
      result: { content: string; details?: unknown },
    ) {
      // Each handler observes the previous one's output replacement — same reason as
      // PreToolUse for driving the dispatch by hand.
      const selected = select('PostToolUse', (m) => matchesToolName(m, toolName), {
        ifCtx: { toolName, toolInput: input },
      })
      if (!selected) return {}
      const inputFor = (content: string): CcHookInput => ({
        ...baseInput('PostToolUse'),
        tool_name: toolName,
        tool_input: input,
        tool_response: { content, details: result.details },
      })
      fireAsync(selected.async, inputFor(result.content))
      const contexts: (string | undefined)[] = []
      // Last non-empty updatedToolOutput wins; later hooks observe the replaced
      // content (mirrors the native onPostToolCall replaceContent chain).
      let replaced: string | undefined
      for (const h of selected.sync) {
        const o = await runHandler('PostToolUse', h, inputFor(replaced ?? result.content), false)
        // PostToolUse cannot block (tool already ran); we surface reason + context.
        contexts.push(o.additionalContext, o.decision === 'block' ? o.reason : undefined)
        if (typeof o.updatedToolOutput === 'string' && o.updatedToolOutput.trim()) {
          replaced = o.updatedToolOutput
        }
      }
      const additionalContext = joinContext(contexts)
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...(replaced !== undefined ? { updatedToolOutput: replaced } : {}),
      }
    },

    async runStop(stopOpts) {
      const input: CcHookInput = {
        ...baseInput('Stop'),
        ...(stopOpts?.stopHookActive ? { stop_hook_active: true } : {}),
      }
      return blockedFrom(await runAll('Stop', () => true, input, false))
    },

    async runSessionEnd(reason: string) {
      const input: CcHookInput = { ...baseInput('SessionEnd'), reason }
      // Side-effects only (no decision control); output ignored.
      await runAll('SessionEnd', (m) => matchesField(m, reason), input, false)
    },

    async runNotification(notification) {
      const notificationType = notification.notificationType ?? ''
      const input: CcHookInput = {
        ...baseInput('Notification'),
        message: notification.message,
        ...(notification.title ? { title: notification.title } : {}),
        ...(notificationType ? { notification_type: notificationType } : {}),
      }
      // Observer-only (no decision control, per the CC spec); output ignored.
      await runAll('Notification', (m) => matchesField(m, notificationType), input, false)
    },

    async runSubagentStart(agentType: string, agentId: string) {
      const input: CcHookInput = {
        ...baseInput('SubagentStart'),
        agent_id: agentId,
        agent_type: agentType,
      }
      const additionalContext = contextFrom(
        await runAll('SubagentStart', (m) => matchesField(m, agentType), input, false),
      )
      return additionalContext ? { additionalContext } : {}
    },

    async runSubagentStop(agentType, agentId, lastMessage, subOpts) {
      const sourcesOnly = subOpts?.sourcesOnly
      const input: CcHookInput = {
        ...baseInput('SubagentStop'),
        agent_id: agentId,
        agent_type: agentType,
        ...(lastMessage ? { last_assistant_message: lastMessage } : {}),
        ...(subOpts?.stopHookActive ? { stop_hook_active: true } : {}),
      }
      return blockedFrom(
        await runAll('SubagentStop', (m) => matchesField(m, agentType), input, false, {
          filter: (h) => !sourcesOnly || sourcesOnly.includes(h.source),
        }),
      )
    },

    async runPreCompact(trigger: 'manual' | 'auto', customInstructions?: string) {
      const input: CcHookInput = {
        ...baseInput('PreCompact'),
        trigger,
        custom_instructions: customInstructions ?? '',
      }
      return blockedFrom(await runAll('PreCompact', (m) => matchesField(m, trigger), input, false))
    },
  }
}
