/**
 * UNFINISHED WORK ABOVE THE COMPOSER — one row per resume point, each with Continue.
 *
 * The general row for every kind that has no row of its own (`RESUME_KINDS_WITH_OWN_ROW`): a new
 * producer on the server (`features/resume`) appears here without a line of UI. Like every
 * Continue, it shows only while nobody is working on the conversation.
 */
import { memo } from 'react'
import { Play } from 'lucide-react'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

import { usePlanOwnerId } from '../../model/plans'
import {
  RESUME_KINDS_WITH_OWN_ROW,
  useConversationIdle,
  useResume,
  useResumePoints,
} from '../../model/resume'
import { ContinueButton } from './ContinueButton'

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
          tone="info"
          icon={<Play className="size-3.5" />}
          title={`${point.title} paused`}
          description={point.detail ?? undefined}
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
