import { dayLabel } from '@/shared/lib/calendarDay'
import { LabelDivider } from '@localixai/kit/label-divider'

/**
 * The day a run of messages belongs to, drawn above the first card of that day.
 *
 * A transcript without these reads as one continuous run however long it spans, and the only
 * way to place a message in time is to hover its clock. It is also what lets the per-message
 * clock stay a bare clock: the date is stated once for the whole day instead of on every card.
 *
 * It is rendered by the card that opens the day rather than as a row of its own, so the
 * virtualized list keeps one row per message and its measurement stays honest.
 */
export function DayDivider({ day }: { day: Date }) {
  return (
    <LabelDivider className="mb-3">
      <time dateTime={day.toISOString()}>{dayLabel(day)}</time>
    </LabelDivider>
  )
}
