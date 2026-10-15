import { memo } from 'react'
import { ChartNoAxesColumn } from 'lucide-react'
import type { ChatUsagePayload } from '@localixai/agent'
import { Button } from '@localixai/kit/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@localixai/kit/hover-card'
import { inspector } from '@/shared/lib/inspectorBus'
import { UsageTotals } from './UsageTotals'
import { ParticipantUsageRow } from './ParticipantUsageRow'
import { findSessionInState } from '../../model/findSession'
import { useChatStore } from '../../model/store'
import type { SessionAgentRoute } from '@/shared/api/contracts'

const NO_AGENTS: readonly SessionAgentRoute[] = []

/**
 * Session-wide totals belong to the conversation actions, outside the participant roster. In a
 * group the card also breaks them down per participant — the one place usage is shown.
 */
export const SessionUsageIndicator = memo(function SessionUsageIndicator({
  usage,
  sessionId,
}: {
  usage?: ChatUsagePayload
  sessionId?: string | null
}) {
  const agents = useChatStore((state) => findSessionInState(state, sessionId)?.agents) ?? NO_AGENTS
  const participantUsage = useChatStore(
    (state) => findSessionInState(state, sessionId)?.participantUsage,
  )
  if (!usage) return null
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="gap-1.5 text-text-soft"
          aria-label="Total session usage"
          onClick={() => inspector.openStats()}
        >
          <ChartNoAxesColumn className="size-3.5" aria-hidden="true" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="max-h-[min(32rem,var(--radix-hover-card-content-available-height))] w-72 max-w-[calc(100vw-1rem)] gap-3 overflow-y-auto select-text"
      >
        <p className="text-2xs font-medium text-text-strong">Session total</p>
        <UsageTotals usage={usage} />
        {sessionId && agents.length > 1 ? (
          <section
            aria-label="Usage by participant"
            className="space-y-2 border-t border-border-soft pt-3"
          >
            <p className="text-2xs font-medium text-text-strong">By participant</p>
            <ul className="space-y-2.5">
              {agents.map((agent) => (
                <ParticipantUsageRow
                  key={agent.agentId}
                  sessionId={sessionId}
                  agentId={agent.agentId}
                  handle={agent.handle}
                  usage={participantUsage?.[agent.agentId]}
                />
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-2xs text-text-faint">
          All participants, including those removed, and session services.
        </p>
      </HoverCardContent>
    </HoverCard>
  )
})
