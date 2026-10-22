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
import { executeHookInBackground } from './executor'
import { matchesField } from './matcher'
import type { CcHooksRuntime, CcRunStop, CreateCcHooksRuntimeOptions } from './runtime-contracts'
import {
  EMPTY_RUNTIME,
  joinContext,
  contextFrom,
  blockedFrom,
  stopVerdictFrom,
} from './runtime-results'
import { createHookSelector, spendOnce, type SelectOptions } from './runtime-selection'
import { createHookHandlerRunner } from './runtime-handler'
import { createToolHookRunners } from './runtime-tool-hooks'
import { createGateHookRunners } from './runtime-gate-hooks'
import { createSessionHookRunners, watchPathsFrom } from './runtime-session-hooks'
import { createDisplayHookRunners } from './runtime-display-hooks'
import { createWorktreeHookRunners } from './runtime-worktree-hooks'
import { envFileForEvent } from './session-env'

export type { CcHooksRuntime, CreateCcHooksRuntimeOptions } from './runtime-contracts'

/** The events whose documented input carries `permission_mode` (hooks.md, each event's example). */
const PERMISSION_MODE_EVENTS: ReadonlySet<CcHookEvent> = new Set<CcHookEvent>([
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PermissionDenied',
  'SubagentStop',
  'TaskCompleted',
  'Stop',
  'TeammateIdle',
])

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
    permissionMode,
    agent,
    envFiles,
    onAsyncContext,
  } = opts
  const hasAny = Object.values(registry).some((groups) => groups && groups.length > 0)
  if (!enabled || !hasAny) return EMPTY_RUNTIME

  // Teardown has its own bounded lifetime: cancelling a turn must not skip cleanup hooks.
  const signalFor = (event: CcHookEvent) => (event === 'SessionEnd' ? undefined : runSignal)

  const baseInput = <E extends CcHookEvent>(event: E) => ({
    session_id: sessionId,
    // No transcript file is kept by this host: the documented field is sent, empty.
    transcript_path: '',
    cwd: projectDir,
    ...(permissionMode && PERMISSION_MODE_EVENTS.has(event)
      ? { permission_mode: permissionMode }
      : {}),
    hook_event_name: event,
    // hooks.md: tool events inside a subagent carry "the agent_id and agent_type common input
    // fields that identify the subagent".
    ...(agent ? { agent_id: agent.id, agent_type: agent.type } : {}),
  })
  const envFor = (event: CcHookEvent) => {
    const envFile = envFileForEvent(envFiles, event)
    return envFile ? { envFile } : undefined
  }

  const select = createHookSelector({ registry, sessionId, logger, onceKeys, signalFor })
  const runHandler = createHookHandlerRunner({
    projectDir,
    logger,
    evaluatePromptHook,
    runAgentHook,
    callMcpTool,
    emitNotice,
    signalFor,
    envFor,
    onceKeys,
  })

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
        envFor(input.hook_event_name),
        (context) => {
          spendOnce(onceKeys, input.hook_event_name, h)
          if (context) onAsyncContext?.(context)
        },
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
   * `select` + `fireAsync` + `runHandler` directly (`runtime-tool-hooks.ts`) rather than bending
   * this contract.
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

  // The hook that ended this run (PreToolUse `continue:false`, a PostToolBatch block).
  let runStop: CcRunStop | undefined
  const stopRun = (stop: CcRunStop) => {
    runStop ??= stop
  }
  const dispatch = { select, runHandler, fireAsync, runAll, baseInput, emitNotice, stopRun }
  // Inputs a PermissionRequest hook rewrote, by tool call, until the call runs.
  const approvedInputs = new Map<string, unknown>()

  return {
    active: true,
    stoppedBy: () => runStop,

    async runSessionStart(source = 'startup') {
      const input: CcHookInput = { ...baseInput('SessionStart'), source }
      const outcomes = await runAll('SessionStart', (m) => matchesField(m, source), input, true)
      const additionalContext = contextFrom(outcomes)
      // `sessionTitle` "applies when source is startup, resume, or fork" — the last one named.
      const sessionTitle =
        source === 'clear' || source === 'compact'
          ? undefined
          : outcomes.reduce<string | undefined>((title, o) => o.sessionTitle ?? title, undefined)
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...watchPathsFrom(outcomes),
        ...(sessionTitle ? { sessionTitle } : {}),
      }
    },

    async runUserPromptSubmit(prompt: string) {
      // Stops at the first blocking handler — so it drives the dispatch itself.
      const selected = select('UserPromptSubmit', () => true)
      if (!selected) return { blocked: false }
      const input: CcHookInput = { ...baseInput('UserPromptSubmit'), prompt }
      fireAsync(selected.async, input)
      const contexts: (string | undefined)[] = []
      // `sessionTitle` names the session from the prompt; the last handler to give one wins.
      let sessionTitle: string | undefined
      const titled = () => (sessionTitle ? { sessionTitle } : {})
      for (const h of selected.sync) {
        const o = await runHandler('UserPromptSubmit', h, input, true)
        sessionTitle = o.sessionTitle ?? sessionTitle
        if (o.blocked || o.decision === 'block' || o.continue === false) {
          return {
            blocked: true,
            reason: o.blockReason || o.reason || o.stopReason || 'Prompt blocked by hook',
            ...titled(),
          }
        }
        contexts.push(o.additionalContext)
      }
      return { blocked: false, additionalContext: joinContext(contexts), ...titled() }
    },

    ...createToolHookRunners(dispatch),
    ...createGateHookRunners(dispatch),
    hasHooks: (event) => (registry[event]?.length ?? 0) > 0,
    approveWithInput(toolCallId, input) {
      approvedInputs.set(toolCallId, input)
    },
    takeApprovedInput(toolCallId) {
      if (!approvedInputs.has(toolCallId)) return undefined
      const input = approvedInputs.get(toolCallId)
      approvedInputs.delete(toolCallId)
      return { input }
    },
    ...createSessionHookRunners(dispatch, registry, envFiles),
    ...createDisplayHookRunners(dispatch),
    ...createWorktreeHookRunners(dispatch),

    async runStop(stopOpts) {
      const input: CcHookInput = {
        ...baseInput('Stop'),
        stop_hook_active: Boolean(stopOpts?.stopHookActive),
        last_assistant_message: stopOpts?.lastAssistantMessage ?? '',
        // Claude Code's background tasks and crons: this host reports none to a Stop hook.
        background_tasks: [],
        session_crons: [],
      }
      return stopVerdictFrom(await runAll('Stop', () => true, input, false))
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
        stop_hook_active: Boolean(subOpts?.stopHookActive),
        // The subagent's own transcript: empty, as `transcript_path` is (no transcript file).
        agent_transcript_path: '',
      }
      return stopVerdictFrom(
        await runAll('SubagentStop', (m) => matchesField(m, agentType), input, false, {
          filter: (h) => !sourcesOnly || sourcesOnly.includes(h.source),
        }),
      )
    },

    async runPreCompact(trigger: 'manual' | 'auto', customInstructions?: string) {
      const input: CcHookInput = {
        ...baseInput('PreCompact'),
        trigger,
        // hooks.md: "For `auto`, `custom_instructions` is `null`", as for a bare `/compact`.
        custom_instructions: customInstructions ?? null,
      }
      return blockedFrom(await runAll('PreCompact', (m) => matchesField(m, trigger), input, false))
    },
  }
}
