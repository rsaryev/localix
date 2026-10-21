/**
 * UNFINISHED WORK ABOVE THE COMPOSER — one row per resume point, each with Continue.
 *
 * The general row for every kind that has no row of its own (`RESUME_KINDS_WITH_OWN_ROW`): a new
 * producer on the server (`features/resume`) appears here without a line of UI. Like every
 * Continue, it shows only while nobody is working on the conversation.
 */
import { memo } from 'react'
import { Play, TriangleAlert } from 'lucide-react'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

import { usePlanOwnerId } from '../../model/plans'
import {
  RESUME_KINDS_WITH_OWN_ROW,
  useConversationIdle,
  useResume,
  useResumePoints,
} from '../../model/resume'
import { ContinueButton } from './ContinueButton'

/** The conversation's last reply, cut short (`chat/turn-resume.ts` on the server). */
const TURN_KIND = 'turn'

export const ResumeStrip = memo(function ResumeStrip({ sessionId }: { sessionId: string | null }) {
  // The ROOT owns the work, as it owns the plans; the same resolution serves both.
  const ownerId = usePlanOwnerId(sessionId)
  const idle = useConversationIdle(sessionId, ownerId)
  const points = useResumePoints(ownerId).filter(
    (point) => !RESUME_KINDS_WITH_OWN_ROW.has(point.kind),
  )
  const { busyKey, resume } = useResume(ownerId)
  if (!idle || points.length === 0) return null
  return (
    <>
      {points.map((point) => (
        <WorkbenchNoticeBar
          key={point.key}
          role="region"
          aria-label="Unfinished work"
          // A reply that did not finish names itself ("Reply interrupted"); other work is paused.
          tone={point.kind === TURN_KIND ? 'warning' : 'info'}
          icon={
            point.kind === TURN_KIND ? (
              <TriangleAlert className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )
          }
          title={point.kind === TURN_KIND ? point.title : `${point.title} paused`}
          // Truncated to the row; the whole line on hover.
          description={point.detail ? <span title={point.detail}>{point.detail}</span> : undefined}
          actionsLabel="Unfinished work actions"
          actions={
            <ContinueButton
              point={point}
              busy={busyKey === point.key}
              disabled={busyKey !== null && busyKey !== point.key}
              onContinue={(target) => void resume(target)}
            />
          }
        />
      ))}
    </>
  )
})
