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
import {
  isToolEvent,
  type CcHookEvent,
  type CcHookHandler,
  type CcHookInput,
  type CcHookRegistry,
  type CcHookOutcome,
  type CcHookSource,
} from './contracts'
import { executeHook, executeHookInBackground, type HookLogger, type HookRewake } from './executor'
import { executeHttpHook } from './http'
import { plural } from '../../lib/plural'
import { runMcpToolHook, type CcMcpToolCaller } from './mcp-tool-hook'
import { evaluateIfGuard } from './if-guard'
import { matchesField, matchesToolName } from './matcher'
import { mapPromptOutcome, type PromptHookEvaluator } from './prompt-hook'
import type { AgentHookEvaluator } from './agent-hook'
import { runHookOperation } from '../lifecycle-hooks/operation'

/** Aggregated PreToolUse decision handed to the tool wrapper. */
export interface PreToolUseResult {
  /** `deny` blocks the call; `allow`/`ask` are advisory; `proceed` = no opinion. */
  decision: 'deny' | 'allow' | 'ask' | 'proceed'
  reason?: string
  /** Composed input rewrite (re-validated by the caller against the tool schema). */
  updatedInput?: unknown
  didRewrite: boolean
}

export interface PromptSubmitResult {
  blocked: boolean
  reason?: string
  additionalContext?: string
}

export interface StopResult {
  blocked: boolean
  reason?: string
}

/**
 * What `PreCompact` handlers answered. A context checkpoint is announced to them but never
 * waits on or yields to them — see `run/stages/history.ts` — so `blocked` is reported, not obeyed.
 */
export interface PreCompactResult {
  blocked: boolean
  reason?: string
}

export interface CcHooksRuntime {
  /** True when at least one supported hook is registered AND the feature is enabled. */
  readonly active: boolean
  /**
   * Fire the SessionStart hooks. `source` (CC: `startup` | `resume` | `clear` |
   * `compact`, default `startup`) is both reported in the hook input AND used as
   * the matcher value — a hook whose matcher is `compact` only fires on a `compact`
   * source. Returns the joined `additionalContext` to inject into the model.
   */
  runSessionStart(source?: string): Promise<{ additionalContext?: string }>
  runUserPromptSubmit(prompt: string): Promise<PromptSubmitResult>
  runPreToolUse(toolName: string, input: unknown, toolUseId?: string): Promise<PreToolUseResult>
  runPostToolUse(
    toolName: string,
    input: unknown,
    result: { content: string; details?: unknown },
  ): Promise<{ additionalContext?: string; updatedToolOutput?: string }>
  /**
   * Fire the Stop hooks. `stopHookActive` is reported to hooks as `stop_hook_active`
   * — true when this run is ALREADY a Stop-hook-forced continuation (CC loop
   * protection). A `decision:"block"` outcome is surfaced as `{blocked, reason}` for
   * the caller to re-enter the run with.
   */
  runStop(opts?: { stopHookActive?: boolean }): Promise<StopResult>
  /** Session-terminating side-effect hooks. Fire-and-forget (no decision control). */
  runSessionEnd(reason: string): Promise<void>
  /**
   * Fire the Notification hooks — CC's "agent needs the user" signal, raised when a
   * HITL request (ask/quiz/confirm) surfaces. `notificationType` (e.g.
   * `permission_prompt` for a confirm gate, `agent_needs_input` for an ask/quiz) is
   * both reported to hooks AND used as the matcher value. Observer-only side-effect
   * (no decision control, per the CC spec) — fire-and-forget, output ignored.
   */
  runNotification(notification: {
    message: string
    notificationType?: string
    title?: string
  }): Promise<void>
  /** A sub-agent is starting. Returns context to inject into the child (advisory). */
  runSubagentStart(agentType: string, agentId: string): Promise<{ additionalContext?: string }>
  /**
   * A sub-agent finished. `decision:block` is logged (no re-entry), like Stop.
   * `sourcesOnly` restricts firing to the given hook sources — used when a
   * sub-agent run fires its OWN SubagentStop for its scoped (skill/agent)
   * frontmatter hooks, so generic user/project SubagentStop hooks (which the
   * PARENT already fires via the delegate seam) are not double-fired.
   */
  runSubagentStop(
    agentType: string,
    agentId: string,
    lastMessage: string | null,
    opts?: { sourcesOnly?: readonly CcHookSource[]; stopHookActive?: boolean },
  ): Promise<StopResult>
  /**
   * Claude Code's PreCompact: exit 2 / `decision:block` reports a block. This host fires it
   * with `auto` when a context checkpoint is taken, after the view is already decided, so it
   * reads the result as a notice and never lets a block stop the turn.
   */
  runPreCompact(trigger: 'manual' | 'auto', customInstructions?: string): Promise<PreCompactResult>
}

export interface CreateCcHooksRuntimeOptions {
  signal?: AbortSignal
  registry: CcHookRegistry
  sessionId: string
  /** Session cwd → hook cwd + `CLAUDE_PROJECT_DIR`. */
  projectDir: string
  /** Kill switch — when false the runtime is inert. */
  enabled: boolean
  logger: HookLogger
  /**
   * Arms the one wake an `asyncRewake` hook may send, as it starts; the hook's exit 2 fires it
   * with the composed rewake message, any other ending dismisses it.
   * Absent → asyncRewake degrades to plain `async` (fire-and-forget, no wake).
   */
  rewake?: HookRewake
  /**
   * Per-SESSION set of `once`-handler keys that already ran (owned by the caller
   * so it survives across the per-run runtimes). Absent → `once` is not enforced.
   */
  onceKeys?: Set<string>
  /**
   * Injected single-shot LLM evaluator for `type:"prompt"` handlers. Absent → prompt
   * handlers fail open (treated as `ok`, never block). Keeps cc-hooks chat-agnostic.
   */
  evaluatePromptHook?: PromptHookEvaluator
  /**
   * Injected bounded-sub-agent evaluator for `type:"agent"` handlers (a tool-using
   * verifier). Absent → agent handlers fail open. Keeps cc-hooks chat-agnostic.
   */
  runAgentHook?: AgentHookEvaluator
  /**
   * Injected MCP tool caller for `type:"mcp_tool"` handlers, built by the chat
   * runtime from the process-lifetime MCP client manager. Absent → mcp_tool handlers
   * fail open. Keeps cc-hooks free of any MCP-feature import.
   */
  callMcpTool?: CcMcpToolCaller
  /**
   * Injected sink for a hook's non-blocking `systemMessage` — a user-facing
   * warning (CC: "shown to the user in the transcript"). The chat runtime wires
   * this to publish a `hook.notice` stream event. Absent → the message is dropped
   * (keeps cc-hooks chat/UI-agnostic). Identical CONSECUTIVE messages within a run
   * are de-duped before this fires.
   */
  emitNotice?: (message: string, event: CcHookEvent) => void
}

const noop = async () => {}
const EMPTY_RUNTIME: CcHooksRuntime = {
  active: false,
  async runSessionStart() {
    return {}
  },
  async runUserPromptSubmit() {
    return { blocked: false }
  },
  async runPreToolUse() {
    return { decision: 'proceed', didRewrite: false }
  },
  async runPostToolUse() {
    return {}
  },
  async runStop() {
    return { blocked: false }
  },
  runSessionEnd: noop,
  runNotification: noop,
  async runSubagentStart() {
    return {}
  },
  async runSubagentStop() {
    return { blocked: false }
  },
  async runPreCompact() {
    return { blocked: false }
  },
}

/** Join non-empty context strings with a blank line. */
function joinContext(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  return kept.length > 0 ? kept.join('\n\n') : undefined
}

/** The context every handler of a context-carrying event contributed, joined. */
function contextFrom(outcomes: CcHookOutcome[]): string | undefined {
  return joinContext(outcomes.map((o) => o.additionalContext))
}

/**
 * The block verdict for a decision-carrying event that CANNOT short-circuit
 * (Stop / SubagentStop / PreCompact): every handler runs, the run is blocked if
 * ANY of them blocked, and the last handler to give a reason owns it.
 */
function blockedFrom(outcomes: CcHookOutcome[]): StopResult {
  let blocked = false
  let reason: string | undefined
  for (const o of outcomes) {
    if (o.blocked || o.decision === 'block') {
      blocked = true
      reason = o.blockReason || o.reason || reason
    }
  }
  return { blocked, ...(reason ? { reason } : {}) }
}

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

  /** `once` per-session key for a handler (stable across the per-run runtimes). */
  const onceKey = (event: CcHookEvent, h: CcHookHandler): string =>
    `${event}::${h.source}::${h.pluginName ?? ''}::${h.command || h.prompt || ''}`

  interface SelectOptions {
    /** Tool-event context for `if` guards. */
    ifCtx?: { toolName: string; toolInput: unknown }
    /** Extra restriction applied BEFORE the guards (SubagentStop's `sourcesOnly`). */
    filter?: (h: CcHookHandler) => boolean
  }

  /**
   * The handlers that will actually RUN for one event — or `null` when the event is
   * INERT (no group matched, every `if` guard failed, or the only `once` handlers
   * already ran this session). Every dispatch point short-circuits on that single
   * fact instead of re-deriving "did anything match?" for itself.
   *
   * Selection, in order — the order is the contract:
   *   - group matcher accepts the event's match value (`matchFn`);
   *   - caller `filter`;
   *   - `if` guard: on tool events keep a handler only if its guard passes; on
   *     non-tool events a handler carrying an `if` never runs (CC §3);
   *   - `once`: skip handlers whose key already ran this session; MARK the rest as
   *     run — a selected `once` handler is spent whether or not it later blocks;
   *   - partition into `sync` (block-capable) and `async` (fire-and-forget).
   */
  function select(
    event: CcHookEvent,
    matchFn: (matcher: string | undefined) => boolean,
    opts: SelectOptions = {},
  ): { sync: CcHookHandler[]; async: CcHookHandler[] } | null {
    if (signalFor(event)?.aborted) return null
    const sync: CcHookHandler[] = []
    const asyncH: CcHookHandler[] = []
    for (const group of registry[event] ?? []) {
      if (!matchFn(group.matcher)) continue
      for (const h of group.handlers) {
        if (opts.filter && !opts.filter(h)) continue
        if (h.if) {
          if (!isToolEvent(event) || !opts.ifCtx) continue // `if` only applies on tool events
          if (!evaluateIfGuard(h.if, opts.ifCtx.toolName, opts.ifCtx.toolInput)) continue
        }
        if (h.once && onceKeys) {
          const key = onceKey(event, h)
          if (onceKeys.has(key)) continue
          onceKeys.add(key)
        }
        ;(h.async ? asyncH : sync).push(h)
      }
    }
    const count = sync.length + asyncH.length
    if (count === 0) return null
    logger.info?.(`[cc-hooks] session ${sessionId}: ${event} fired ${plural(count, 'hook')}`)
    return { sync, async: asyncH }
  }

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
