import type { EventFactsOf, HookEvent, HookOutcome, PluginSession } from '@rsaryev/llx-plugin'
import type { HookSourceKind } from '@rsaryev/llx-plugin/hooks'
import type { CcHooksRuntime, CcRunStop } from '../../../cc-hooks/runtime-contracts'
import { joinContext } from '../../../cc-hooks/runtime-results'
import type { CcTranscript } from '../../../cc-hooks/transcript'
import { createDisplayEvents } from './display-events'
import { byFile } from './file-calls'
import { createSessionEvents } from './session-events'
import { createToolEvents } from './tool-events'

/** What a run tells its hooks beyond the session: where to say things, and what runs beside it. */
export interface KitHooksRuntimeOptions {
  readonly signal?: AbortSignal
  /** Written before a hook reads it (`transcript_path`). */
  readonly transcript?: CcTranscript
  /** The run's folder: a hook's file paths are absolute against it. */
  readonly cwd: string
  /** The run's model (SessionStart's `model`). */
  readonly model?: string
  /** Stop and SubagentStop's `background_tasks` and `session_crons`. */
  readonly backgroundWork?: () => { background_tasks: unknown[]; session_crons: unknown[] }
  /** What a hook shows the person (`systemMessage`, a failed hook's notice). */
  readonly emitNotice?: (message: string, event: HookEvent) => void
  /** The sources every dispatch is limited to (between runs: none of a run's own). */
  readonly sourcesOnly?: readonly HookSourceKind[]
}

export interface FireOptions {
  readonly sourcesOnly?: readonly HookSourceKind[]
  /** A subagent whose transcript the hook reads (`agent_transcript_path`). */
  readonly agentId?: string
}

/** One dispatch of the run, `undefined` when no hook listens. */
export type Fire = <E extends HookEvent>(
  event: E,
  facts: EventFactsOf<E>,
  options?: FireOptions,
) => Promise<HookOutcome<E> | undefined>

/** What an event family is built over. */
export interface EventDeps {
  readonly fire: Fire
  readonly cwd: string
  readonly options: KitHooksRuntimeOptions
  readonly stop: (stop: CcRunStop) => void
}

const STOPS_RUN = new Set<HookEvent>(['PreToolUse', 'PostToolUse', 'PostToolBatch'])

/** What the outcome tells Claude: context, the stderr it is shown, and a block routed to it. */
export function claudeText(outcome: HookOutcome<HookEvent> | undefined): string | undefined {
  if (!outcome) return undefined
  return joinContext([
    ...outcome.additionalContext,
    ...outcome.feedback.filter((one) => one.to === 'claude').map((one) => one.text),
    outcome.block?.to === 'claude' ? outcome.block.reason : undefined,
  ])
}

/**
 * The run's hooks on the kit session: each event a dispatch, its outcome folded into what the
 * chat runtime applies. The session selects, gates, runs and merges; this says it to the run.
 */
export function createKitHooksRuntime(
  session: PluginSession,
  options: KitHooksRuntimeOptions,
): CcHooksRuntime {
  const signal = options.signal ?? new AbortController().signal
  let stopped: CcRunStop | undefined
  const stop = (given: CcRunStop) => {
    stopped ??= given
    options.emitNotice?.(given.reason, given.event)
  }
  const fire: Fire = async (event, facts, more = {}) => {
    if (!session.hasHooks(event)) return undefined
    await options.transcript?.refresh(more.agentId)
    const sourcesOnly = more.sourcesOnly ?? options.sourcesOnly
    const outcome = await session.dispatch(event, facts, {
      signal,
      ...(sourcesOnly ? { sourcesOnly } : {}),
    })
    const said = [
      ...outcome.notices.map((notice) => notice.message),
      ...outcome.systemMessages,
      ...outcome.feedback.filter((one) => one.to === 'user').map((one) => one.text),
    ]
    for (const message of said) options.emitNotice?.(message, event)
    if (!outcome.continue && STOPS_RUN.has(event))
      stop({
        event: event as CcRunStop['event'],
        reason: outcome.stopReason?.trim() || `A ${event} hook stopped the run.`,
      })
    return outcome
  }
  const deps: EventDeps = { fire, cwd: options.cwd, options, stop }
  const approved = new Map<string, unknown>()
  const tools = createToolEvents(deps)
  return {
    active: true,
    hasHooks: (event) => session.hasHooks(event),
    fileChangedWatchNames: () => [...session.fileChangedWatchList()],
    approveWithInput: (toolCallId, input) => void approved.set(toolCallId, input),
    takeApprovedInput(toolCallId) {
      if (!approved.has(toolCallId)) return undefined
      const input = approved.get(toolCallId)
      approved.delete(toolCallId)
      return { input }
    },
    stoppedBy: () => stopped,
    ...tools,
    // A Localix call of several files is one Claude Code call per file.
    ...byFile(tools),
    ...createSessionEvents(deps),
    ...createDisplayEvents(deps),
  }
}
