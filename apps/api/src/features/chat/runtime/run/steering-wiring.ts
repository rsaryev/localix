import type { SteeringBoundary } from '@localixai/agent'

import { midRunInterjectEnabled } from '../../../agent-core/interjection'
import { buildRuntimeSteering } from './runtime-execution'
import type { RunFrame } from './stages/frame'
import type { ResolvedTurn } from './stages/turn'
import { createSteeringTaker, createToolCallDeferral } from './steering'

/**
 * Mid-run steering for the stream stage: the `takeSteering` callback and, when the session
 * steers at all, the tool-call deferral that lets a waiting person's message outrank calls
 * chosen without it. A completed child report joins only once per settled tool turn. The engine
 * asks only once this host has handled every event it emitted, so the transcript has already
 * caught up with the turn the boundary names.
 */
export function wireRunSteering(frame: RunFrame, turn: Pick<ResolvedTurn, 'state' | 'policy'>) {
  const { env, abort, session } = frame
  const { state, policy } = turn
  const { repo, now } = env
  let requestedToolTurnIndex: number | undefined
  let deliveredToolTurnIndex: number | undefined

  const steers = midRunInterjectEnabled() && policy.host.steers
  const surface = frame.params.scope.executionContext.clientSurface
  // Where a delegated child's report may join this turn: a conversation that has children.
  const childReports = policy.conversation.childReports
  const takeFromQueue = steers
    ? createSteeringTaker({
        env,
        repo,
        sessionId: session.id,
        now,
        signal: abort.signal,
        steerCtxRef: frame.steerCtxRef,
        ...(surface ? { surface } : {}),
        ...(childReports
          ? {
              subagent: {
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
          ...(surface ? { surface } : {}),
        }),
      }
    : {}

  return { takeSteering, deferral }
}
