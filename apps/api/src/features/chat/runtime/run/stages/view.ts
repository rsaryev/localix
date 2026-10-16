/**
 * Stage 2b — view: resolve the model view this run starts from, before anything is built on it.
 *
 * The prompt snapshot (stage 3) and the history (stage 7) must agree on whether this turn
 * starts a new view epoch: the snapshot refreshes memory and skills exactly when the history is
 * re-planned, because that is the one moment the whole cached prefix is rewritten anyway. So the
 * decision is taken once, here, from durable facts — the checkpoint in force and the provider's
 * last measurement — plus the one-shot signals a previous segment left on the lane: a recovery
 * re-entry, or an in-run prune.
 */
import { createModelContextRepository } from '../../../model-context-repository'
import { sessionAgent } from '../../message-envelope'
import { loadModelView, type ModelView } from '../../model-view/view'
import { delegationPlace } from '../../../session-provenance'
import type { RunFrame } from './frame'
import type { ResolvedTurn } from './turn'

export async function resolveRunView(frame: RunFrame, turn: ResolvedTurn): Promise<ModelView> {
  const { env, params, session, speakerAgentId } = frame
  const lane = frame.stores.context
  const forced = lane.checkpointDue
  // Consumed here: the signal asks for ONE checkpoint, on the next turn that builds a view.
  delete lane.checkpointDue
  return loadModelView(createModelContextRepository(env.deps.db), {
    sessionId: session.id,
    viewer: sessionAgent(session, speakerAgentId),
    historyMessages: params.historyMessages,
    currentMessageId: frame.assistantMessageId,
    ...(params.contextBoundaryId ? { contextBoundaryId: params.contextBoundaryId } : {}),
    ...(turn.catalogModel?.contextLength !== undefined
      ? { contextWindow: turn.catalogModel.contextLength }
      : {}),
    // The same depth the prompt stage budgets with, so a child's checkpoint fires at ITS ceiling.
    depth: delegationPlace(session.provenance).depth,
    contextPercent: turn.contextPercent,
    ...(forced ? { forced } : {}),
  })
}
