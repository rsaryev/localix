import type { SteeringBoundary } from '@localixai/agent'
import { agentParticipant } from '../../../../db/participant'

import { midRunInterjectEnabled } from '../../../agent-core/interjection'
import { buildRuntimeSteering } from './runtime-execution'
import type { RunFrame } from './stages/frame'
import type { ResolvedTurn } from './stages/turn'
import { addressedToSpeaker, createSteeringTaker, createToolCallDeferral } from './steering'

/**
 * Mid-run steering for the stream stage: the `takeSteering` callback and, when the session
 * steers at all, the tool-call deferral that lets a waiting person's message outrank calls
 * chosen without it. A completed child report joins only once per settled tool turn. The engine
 * asks only once this host has handled every event it emitted, so the transcript has already
 * caught up with the turn the boundary names.
 */
export function wireRunSteering(frame: RunFrame, turn: Pick<ResolvedTurn, 'state' | 'policy'>) {
  const { env, session, speakerAgentId, abort } = frame
  const { state, policy } = turn
  const { repo, now } = env
  let requestedToolTurnIndex: number | undefined
  let deliveredToolTurnIndex: number | undefined

  const steers = midRunInterjectEnabled() && policy.host.steers
  const accepts = (content: string) => addressedToSpeaker(content, session.agents, speakerAgentId)
  const surface = frame.params.scope.executionContext.clientSurface
  // Where a delegated child's report may join this turn: a conversation that has children.
  const childReports = policy.conversation.childReports
  const steeringAddress = childReports
    ? { participant: agentParticipant(speakerAgentId), ...childReports }
    : undefined
  const takeFromQueue = steers
    ? createSteeringTaker({
        env,
        repo,
        sessionId: session.id,
        now,
        signal: abort.signal,
        steerCtxRef: frame.steerCtxRef,
        accepts,
        ...(surface ? { surface } : {}),
        ...(steeringAddress
          ? {
              subagent: {
                address: steeringAddress,
                canDeliver: () =>
                  requestedToolTurnIndex !== undefined &&
                  requestedToolTurnIndex === state.completedToolTurnIndex &&
                  deliveredToolTurnIndex !== requestedToolTurnIndex,
                onDelivered: () => {
                  deliveredToolTurnIndex = requestedToolTurnIndex
                },
              },
            }
          : {}),
      })
    : undefined
  const takeSteering = buildRuntimeSteering({
    takeUserMessages: takeFromQueue
      ? (boundary?: SteeringBoundary) => {
          requestedToolTurnIndex = boundary?.completedToolTurnIndex
          return takeFromQueue()
        }
      : undefined,
  })
  const deferral = steers
    ? {
        shouldDeferToolCalls: createToolCallDeferral({
          env,
          sessionId: session.id,
          signal: abort.signal,
          accepts,
          ...(surface ? { surface } : {}),
        }),
      }
    : {}

  return { takeSteering, deferral }
}
