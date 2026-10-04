/**
 * THE MODEL VIEW a run starts from: the durable facts that decide how its history is shown —
 * which checkpoint is in force, what runtime context the agent already has, and whether this
 * turn must take a new checkpoint.
 *
 * Resolved ONCE, at the start of the run, because two consumers need the same answer at
 * different stages: the prompt snapshot (which is frozen per view epoch, so memory and skills
 * refresh exactly when the view is rewritten anyway) and the history build. Deciding twice would
 * let them disagree about whether this turn starts a new epoch.
 *
 * Load → decide: the repository reads happen here and nowhere in the history pipeline, which
 * stays a pure function of this value and the rows.
 */
import type { CheckpointReason, ContextCheckpoint } from '@localixai/agent'

import { participantAgentId } from '../../../../db/participant'
import type { PersistedMessage, SessionModelView } from '../../contracts'
import type { ModelContextRepository } from '../../model-context-repository'
import { resolveContextBudgetFrame } from '../context-budget'
import { checkpointPressure } from './checkpoint-policy'
import { turnContextState, type StoredTurnContext, type TurnContextState } from './turn-context'

export interface ModelView {
  /** The participant whose view this is (`agent:<id>`). */
  viewer: string
  /** The viewer's own past turn contexts, by the assistant row that sent them. */
  turnContexts: ReadonlyMap<string, StoredTurnContext>
  /** The checkpoint in force, and the assistant row of the run that took it. */
  checkpoint?: { hostId: string; record: ContextCheckpoint }
  /** The runtime context the viewer already has; absent starts a fresh one. */
  previous?: { state: TurnContextState; bindingIds: ReadonlySet<string> }
  /** Why this turn takes a checkpoint, when it must. */
  due?: CheckpointReason
  /** The view is past the warning mark: the next checkpoint is a turn or two away. */
  checkpointNear?: true
  /**
   * Identity of the view the model is shown: the checkpoint in force (this run's own, when one
   * is due), else the last `/clear`, else the conversation start. The prompt snapshot and the
   * provider-measured size anchor are both valid only within one epoch.
   */
  epochId: string
}

/** The model-facing rows after the last `/clear` — the only boundary that cuts by position. */
export function rowsAfterClear(messages: readonly PersistedMessage[]): {
  rows: PersistedMessage[]
  clearId?: string
} {
  let cut = -1
  for (let i = 0; i < messages.length; i++) if (messages[i]!.payload.contextBoundary) cut = i
  return {
    rows: messages.slice(cut + 1).filter((m) => !m.payload.uiOnly && !m.payload.systemNotice),
    ...(cut >= 0 ? { clearId: messages[cut]!.id } : {}),
  }
}

const isViewerTurn = (message: PersistedMessage, viewer: string) =>
  message.payload.role === 'assistant' && message.payload.from === viewer

/**
 * Where the viewer's last measured request, taken under the view in force, sits against the
 * checkpoint marks. Only a measurement made after the checkpoint describes the current view.
 */
function measuredPressure(
  rows: readonly PersistedMessage[],
  viewer: string,
  hostId: string | undefined,
  contextWindow: number | undefined,
  depth: number | undefined,
): ReturnType<typeof checkpointPressure> {
  const from = hostId ? rows.findIndex((row) => row.id === hostId) : 0
  for (let i = rows.length - 1; i >= Math.max(0, from); i--) {
    const row = rows[i]!
    if (!isViewerTurn(row, viewer)) continue
    const tokens = row.payload.usage?.contextTokens
    if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) continue
    return checkpointPressure(resolveContextBudgetFrame({ contextWindow, depth }), tokens)
  }
  return 'clear'
}

/**
 * Where the newest checkpoint on this branch cut the model's view — what the transcript shows as
 * its divider. Newest across participants: in a group, the latest speaker's view is the one the
 * conversation is being read through now.
 */
export async function loadModelViewBoundary(
  repo: ModelContextRepository,
  sessionId: string,
  messages: readonly PersistedMessage[],
): Promise<SessionModelView | null> {
  const { rows } = rowsAfterClear(messages)
  const assistants = rows.filter((row) => row.payload.role === 'assistant')
  const stored = await repo.list(
    sessionId,
    assistants.map((row) => row.id),
  )
  for (let i = assistants.length - 1; i >= 0; i--) {
    const row = assistants[i]!
    if (!stored.get(row.id)?.hasCheckpoint) continue
    const agentId = participantAgentId(row.payload.from)
    const record = await repo.getCheckpoint(sessionId, row.id)
    return record?.evictedThroughId && agentId
      ? { agentId, evictedThroughId: record.evictedThroughId }
      : null
  }
  return null
}

export async function loadModelView(
  repo: ModelContextRepository,
  input: {
    sessionId: string
    viewer: string
    historyMessages: readonly PersistedMessage[]
    /** The assistant row this run writes — the host of any checkpoint it takes. */
    currentMessageId: string
    contextWindow?: number
    /** The session's delegation depth — the window it budgets against (`contextWindowCapAt`). */
    depth?: number
    /** A recovery re-entry, or a signal the previous run left, that forces a checkpoint. */
    forced?: CheckpointReason
  },
): Promise<ModelView> {
  const { rows, clearId } = rowsAfterClear(input.historyMessages)
  const viewerRowIds = rows.filter((row) => isViewerTurn(row, input.viewer)).map((row) => row.id)
  const stored = await repo.list(input.sessionId, viewerRowIds)

  const turnContexts = new Map<string, StoredTurnContext>()
  let hostId: string | undefined
  for (const id of viewerRowIds) {
    const row = stored.get(id)
    if (row?.turnContext) turnContexts.set(id, row.turnContext)
    if (row?.hasCheckpoint) hostId = id
  }
  const record = hostId ? await repo.getCheckpoint(input.sessionId, hostId) : undefined

  const contexts = [...turnContexts.values()]
  let lastFull = 0
  contexts.forEach((context, index) => {
    if (context.full) lastFull = index
  })
  const previous =
    contexts.length > 0
      ? {
          state: turnContextState(contexts),
          bindingIds: new Set(
            contexts
              .slice(lastFull)
              .flatMap((context) => (context.bindings ?? []).map((binding) => binding.id)),
          ),
        }
      : undefined

  const pressure = measuredPressure(rows, input.viewer, hostId, input.contextWindow, input.depth)
  const due = input.forced ?? (pressure === 'due' ? 'threshold' : undefined)
  return {
    viewer: input.viewer,
    turnContexts,
    ...(hostId && record ? { checkpoint: { hostId, record } } : {}),
    ...(previous ? { previous } : {}),
    ...(due ? { due } : {}),
    ...(!due && pressure === 'near' ? { checkpointNear: true } : {}),
    epochId: due ? input.currentMessageId : (hostId ?? clearId ?? ''),
  }
}
