import { memo } from 'react'
import { ChartNoAxesColumn } from 'lucide-react'
import type { ChatUsagePayload } from '@localixai/agent'
import { Button } from '@localixai/kit/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@localixai/kit/hover-card'
import { inspector } from '@/shared/lib/inspectorBus'
import { UsageTotals } from './UsageTotals'

/** Session-wide totals belong to the conversation actions, outside the participant roster. */
export const SessionUsageIndicator = memo(function SessionUsageIndicator({
  usage,
}: {
  usage?: ChatUsagePayload
}) {
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
        className="w-64 max-w-[calc(100vw-1rem)] gap-3 select-text"
      >
        <p className="text-2xs font-medium text-text-strong">Session total</p>
        <UsageTotals usage={usage} />
        <p className="text-2xs text-text-faint">
          All participants, including those removed, and session services.
        </p>
      </HoverCardContent>
    </HoverCard>
  )
})
