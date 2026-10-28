import { memo } from 'react'
import { ChartNoAxesColumn } from 'lucide-react'
import type { ChatUsagePayload } from '@localixai/agent'
import { Button } from '@localixai/kit/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@localixai/kit/hover-card'
import { inspector } from '@/shared/lib/inspectorBus'
import { UsageTotals } from './UsageTotals'

/** Session-wide totals, shown in the hover card of the conversation's usage icon. */
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
        className="max-h-[min(32rem,var(--radix-hover-card-content-available-height))] w-72 max-w-[calc(100vw-1rem)] gap-3 overflow-y-auto select-text"
      >
        <p className="text-2xs font-medium text-text-strong">Session total</p>
        <UsageTotals usage={usage} />
        <p className="text-2xs text-text-faint">Includes session services.</p>
      </HoverCardContent>
    </HoverCard>
  )
})
