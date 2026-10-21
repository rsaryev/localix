/**
 * A PLAN THAT WAS SET ASIDE, AND THE WAY BACK TO IT.
 *
 * A dismissed version used to be final. Leaving Plan mode dismissed the waiting version, the
 * person could not bring it back, and the agent ended up retyping the same plan verbatim as a new
 * version just to show it again. The server now reopens the NEWEST dismissed version (and returns
 * the conversation to Plan mode), so "Back to review" is offered wherever that version is in
 * view: the plan tab's header and, quietly, the composer strip.
 *
 * Only the newest: once anything newer exists the set-aside version is history, and the server
 * would refuse it (`reopenablePlan`).
 */
import { useState } from 'react'
import { ClipboardX, Undo2 } from 'lucide-react'
import type { SessionPlan } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

import { usePlanDecisions } from '../../model/usePlanDecisions'

export function BackToReviewButton({
  ownerId,
  plan,
}: {
  ownerId: string
  plan: Pick<SessionPlan, 'id' | 'version'>
}) {
  const { busy, reopen } = usePlanDecisions(ownerId)
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={busy !== null}
      title={`Put plan v${plan.version} back in front of you to approve or comment on`}
      onClick={() => void reopen(plan)}
    >
      <Undo2 data-icon="inline-start" aria-hidden />
      {busy === 'reopen' ? 'Reopening…' : 'Back to review'}
    </Button>
  )
}

/**
 * Versions whose strip row the person closed. Module-level, per version, so a strip remount does
 * not bring back a row they already said they do not need; a newer version is a new id.
 */
const closedRows = new Set<string>()

/** The strip's quiet row for the newest version, once set aside. */
export function SetAsidePlanRow({ ownerId, plan }: { ownerId: string; plan: SessionPlan }) {
  const [, rerender] = useState(0)
  if (closedRows.has(plan.id)) return null
  return (
    <WorkbenchNoticeBar
      role="region"
      aria-label="Plan set aside"
      icon={<ClipboardX className="size-3.5" />}
      title={`Plan v${plan.version} set aside`}
      description={<span className="text-text-faint">{plan.title}</span>}
      actionsLabel="Set-aside plan actions"
      actions={<BackToReviewButton ownerId={ownerId} plan={plan} />}
      onDismiss={() => {
        closedRows.add(plan.id)
        rerender((n) => n + 1)
      }}
      dismissLabel="Hide this reminder"
    />
  )
}

export function resetSetAsideRowsForTest(): void {
  closedRows.clear()
}
