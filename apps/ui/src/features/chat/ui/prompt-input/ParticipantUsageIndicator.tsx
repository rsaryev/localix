import { useMemo, type ReactElement } from 'react'
import { createParticipantContextSelector } from '../../model/participantContextUsage'
import { findSessionInState } from '../../model/findSession'
import { useChatStore } from '../../model/store'
import { ParticipantContextUsage } from './ParticipantContextUsage'
import { ChartNoAxesColumn } from 'lucide-react'
import type { ChatUsagePayload } from '@localixai/agent'
import { Button } from '@localixai/kit/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@localixai/kit/hover-card'
import { inspector } from '@/shared/lib/inspectorBus'
import { UsageTotals } from './UsageTotals'

export function ParticipantUsageIndicator({
  name,
  usage,
  agentId,
  sessionId,
  contextWindow,
  children,
}: {
  name: string
  usage?: ChatUsagePayload
  agentId: string
  sessionId?: string | null
  contextWindow?: number
  children?: ReactElement
}) {
  const selectContext = useMemo(
    () => createParticipantContextSelector(agentId, contextWindow),
    [agentId, contextWindow],
  )
  const view = useChatStore((state) =>
    selectContext(findSessionInState(state, sessionId)?.messages ?? []),
  )
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {children ?? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Usage for ${name}`}
            className="text-text-faint"
            onClick={() => inspector.openStats()}
          >
            <ChartNoAxesColumn />
          </Button>
        )}
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="max-h-[min(32rem,var(--radix-hover-card-content-available-height))] w-64 max-w-[calc(100vw-1rem)] gap-3 select-text"
      >
        <p className="text-2xs font-medium text-text-strong">{name} · Session usage</p>
        <ParticipantContextUsage view={view} />
        <UsageTotals usage={usage} />
      </HoverCardContent>
    </HoverCard>
  )
}
