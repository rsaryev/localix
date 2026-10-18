import { lazy, Suspense, type ReactNode } from 'react'
import type { ChatUsagePayload } from '@localixai/agent'
import { StatusTipStrip } from './StatusTipStrip'
import { SpendAlertStrip } from './SpendAlertStrip'
import { UpdateStrip } from './UpdateStrip'
import { LocalModelsStrip } from './LocalModelsStrip'
import { SessionSurface } from '@/shared/contrib/sessionSurfaces'
import { WorkStrip } from './WorkStrip'
import { PlanStrip } from '../plan/PlanStrip'
import { ResumeStrip } from '../resume/ResumeStrip'
import {
  ParticipantsStrip,
  type ConversationFloor,
  type StripParticipantRef,
} from './ParticipantsStrip'
import type { SessionLoopSummary } from '@/shared/api/contracts'
import type { useStreamTip } from '../../model/streamTips'

/**
 * The schedules strip renders only when a session HAS loops, which a fresh launch rarely does, so
 * it loads the first time it has something to show. (The queue lives in the context row above the
 * composer now: `ComposerQueuePanel`.)
 */
const SchedulesPanel = lazy(() =>
  import('./SchedulesPanel').then((module) => ({ default: module.SchedulesPanel })),
)

interface ComposerHeaderStripsProps {
  tip: ReturnType<typeof useStreamTip>['tip']
  onDismissTip: () => void
  runtimePanel?: ReactNode
  activeSessionId: string | null
  isFocused: boolean
  isGenerating: boolean
  sessionUsage?: ChatUsagePayload
  loops?: SessionLoopSummary[]
  /** The conversation's participants, shown as the roster. */
  participants?: readonly StripParticipantRef[]
  /** Which participant holds the floor and who is queued behind them, live. */
  conversationFloor?: ConversationFloor | null
  /** Rendered after the last participant; see ParticipantsStrip for why it is a node. */
  addParticipantControl?: React.ReactNode
  onRemoveParticipant?: (agentId: string) => void
  selectedParticipantId?: string | null
  onSelectParticipant?: (agentId: string) => void
}

/**
 * Header strips clipped to the shell's rounded top so their full-width hover
 * backgrounds (git pill, runtime/sub-agent rows) can't square off the rounded
 * corners. The shell itself stays overflow-visible for the composer popovers
 * below — only this top stack is clipped.
 */
export function ComposerHeaderStrips({
  tip,
  onDismissTip,
  runtimePanel,
  activeSessionId,
  isFocused,
  isGenerating,
  sessionUsage,
  loops,
  participants,
  conversationFloor,
  addParticipantControl,
  onRemoveParticipant,
  selectedParticipantId,
  onSelectParticipant,
}: ComposerHeaderStripsProps) {
  return (
    <div className="overflow-hidden rounded-t-(--radius-composer)">
      {/* A new app version is ready. About the app, not this session, so it leads the stack. */}
      <UpdateStrip isFocused={isFocused} />
      {/* Local models downloading or paused: about the app too, where its update shows. */}
      <LocalModelsStrip isFocused={isFocused} />
      {/* One thin contextual tip strip; stream status lives under the active message. */}
      <StatusTipStrip tip={tip} onDismissTip={onDismissTip} />
      {/* Who is in the conversation. First in the stack because it is the least volatile thing
          here — everything below it is about what is happening right now. */}
      {participants ? (
        <ParticipantsStrip
          participants={participants}
          floor={conversationFloor}
          isGenerating={isGenerating}
          sessionId={activeSessionId}
          addControl={addParticipantControl}
          onRemove={onRemoveParticipant}
          selectedAgentId={selectedParticipantId}
          onSelect={onSelectParticipant}
        />
      ) : null}
      {runtimePanel}
      {/* The plan the agent presented, and the person's decision on it — first:
          a presented plan has ended the agent's turn, so nothing moves until it is decided. */}
      <PlanStrip sessionId={activeSessionId} isFocused={isFocused} />
      {/* Work the agent stopped on that has no row of its own — Continue picks it up again. Below
          the plan, whose own row carries the plan's Continue. */}
      <ResumeStrip sessionId={activeSessionId} />
      {/* The session's running background work (agent jobs, monitors and what they see, streams,
          promoted calls, servers started from the preview), pushed by the server; also hosts
          terminal liveness. */}
      <WorkStrip sessionId={activeSessionId} isFocused={isFocused} />
      {/* Plugin strips about this session's live work. `isFocused` travels as context because
          every warm composer renders this stack: a strip that holds a live subscription mounts it
          only for the focused one. Keyed by session so a strip's in-flight state never carries
          over into the next session's composer. */}
      <SessionSurface
        key={activeSessionId ?? 'none'}
        surface="composer.header"
        sessionId={activeSessionId}
        context={{ isFocused }}
      />
      {/* The session's schedules (loops) — cancelable recurring wake strip. */}
      {loops && loops.length > 0 && (
        <Suspense fallback={null}>
          <SchedulesPanel loops={loops} />
        </Suspense>
      )}
      {/* Metered spend crossed the user's budget (Preferences → Spend alert). */}
      <SpendAlertStrip sessionId={activeSessionId} sessionUsage={sessionUsage} />
    </div>
  )
}
