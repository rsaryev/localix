import { lazy, memo, Suspense } from 'react'
import { useChatStore } from '../../model/store'
import { findSessionInState } from '../../model/findSession'
import { presentedPlan, usePlanList, usePlanOwnerId } from '../../model/plans'

/**
 * Most sessions never have an open queued question, so the panel loads the first time one
 * does — the same bargain the queue and schedules strips make
 * (`ComposerHeaderStrips.tsx`). This gate reads only the count, which a keystroke never changes.
 */
const QuestionsPanel = lazy(() =>
  import('./QuestionsPanel').then((module) => ({ default: module.QuestionsPanel })),
)

/**
 * WHEN ANSWERING IS THE NEXT STEP. A queued question (`ask wait:false`) is answered whenever the
 * person likes, so while the agent is still working it is not the step — the run is. Once the
 * run is idle the questions are what the conversation waits on, and Answer carries the kit's
 * `recommended` mark — unless a plan is waiting: the plan strip above holds the mark then, and
 * two suggestions on one composer would cancel each other out.
 */
export const QuestionsStrip = memo(function QuestionsStrip({
  sessionId,
  isGenerating = false,
}: {
  sessionId: string | null
  isGenerating?: boolean
}) {
  const open = useChatStore((state) => findSessionInState(state, sessionId)?.questions?.length ?? 0)
  const planWaiting = presentedPlan(usePlanList(usePlanOwnerId(sessionId))) !== undefined
  if (!sessionId || open === 0) return null
  return (
    <Suspense fallback={null}>
      <QuestionsPanel sessionId={sessionId} recommendAnswer={!isGenerating && !planWaiting} />
    </Suspense>
  )
})
