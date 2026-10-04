/**
 * THE PLAN WAITING FOR THE PERSON, ABOVE THE COMPOSER — and the decisions on it.
 *
 * The plan tab is where a plan is read; this strip is where it is decided, because a tab can be
 * closed, buried behind others or never opened, and the old plan review left the person with no
 * way back to a plan they still had to decide on. So the strip is shown for as long as a version
 * is `presented`, whatever the tabs are doing, and Open always (re)opens it.
 *
 * Request changes sends the version's OPEN comments — the server takes exactly those rows — so it
 * is disabled while there are none, rather than sending an empty review the server refuses.
 * Whichever of the two is the expected step (`planNextStep`) carries the kit's `recommended` mark;
 * Back to review never does — it recovers a version the person put aside, it is not the next step.
 *
 * After an approval the strip shrinks to the approved version, which keeps steering the agent
 * while it implements: "Implementing plan vN", Open to re-read it, Done to put it aside — and,
 * when nobody is working on it any more, "Plan vN paused" with Continue. Once the
 * agent reports it `completed` the strip shows nothing — a reminder of finished work would read as
 * work still in progress, and the conversation notice already carries the completion.
 *
 * When the newest version was set aside, the strip keeps one quiet row with "Back to review"
 * (`PlanSetAside.tsx`) — the person's only way back to it without asking the agent to retype it.
 * It goes away with anything newer, or when the person closes it.
 */
import { memo, useEffect } from 'react'
import { ClipboardCheck, ClipboardList, MessageSquareDiff, X } from 'lucide-react'
import type { SessionPlan } from '@localixai/api/client'
import { PERMISSION_MODE_COPY } from '@localixai/api/permission-modes'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

import {
  implementingPlan,
  openPlanTab,
  presentedPlan,
  previousVersion,
  reopenablePlan,
  usePlanList,
  usePlanOwnerId,
  usePlansLoaded,
  usePlanTabHost,
} from '../../model/plans'
import { carryOverComments, openComments, usePlanComments } from '../../model/planComments'
import { usePlanDecisions } from '../../model/usePlanDecisions'
import { useConversationIdle, useResume, useResumePoints } from '../../model/resume'
import { ContinueButton } from '../resume/ContinueButton'
import { ApprovePlanPopover, planNextStep } from './ApprovePlanPopover'
import { SetAsidePlanRow } from './PlanSetAside'

export const PlanStrip = memo(function PlanStrip({
  sessionId,
  isFocused = true,
}: {
  sessionId: string | null
  isFocused?: boolean
}) {
  const ownerId = usePlanOwnerId(sessionId)
  usePlansLoaded(ownerId)
  // A version presented just now opens in the focused composer, failing that the conversation's
  // own (root) one, so a plan presented while the person is elsewhere is open when they come back.
  usePlanTabHost(sessionId, ownerId, isFocused)
  const plans = usePlanList(ownerId)
  const presented = presentedPlan(plans)
  const approved = implementingPlan(plans)
  const setAside = reopenablePlan(plans)
  if (!sessionId || !ownerId) return null
  if (presented) {
    return (
      <PresentedPlanRow
        sessionId={sessionId}
        ownerId={ownerId}
        plan={presented}
        previous={previousVersion(plans, presented)}
      />
    )
  }
  if (approved) return <ApprovedPlanRow sessionId={sessionId} ownerId={ownerId} plan={approved} />
  if (setAside) return <SetAsidePlanRow key={setAside.id} ownerId={ownerId} plan={setAside} />
  return null
})

function PresentedPlanRow({
  sessionId,
  ownerId,
  plan,
  previous,
}: {
  sessionId: string
  ownerId: string
  plan: SessionPlan
  previous: SessionPlan | undefined
}) {
  const comments = usePlanComments(plan.id)
  const open = openComments(comments).length
  const { busy, approve, requestChanges, dismiss } = usePlanDecisions(ownerId)
  const next = planNextStep(true, open)
  useEffect(() => {
    if (previous) void carryOverComments(previous, plan)
  }, [previous, plan])

  return (
    <WorkbenchNoticeBar
      role="region"
      aria-label="Plan waiting for review"
      tone="info"
      icon={<ClipboardList className="size-3.5" />}
      title={`Plan v${plan.version}`}
      description={
        <>
          <span className="text-text-soft">{plan.title}</span>
          {open > 0 ? ` · ${open} ${open === 1 ? 'comment' : 'comments'}` : ''}
        </>
      }
      actionsLabel="Plan actions"
      actions={
        <>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => openPlanTab({ sessionId, ownerId, planId: plan.id, title: plan.title })}
          >
            Open
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={open === 0 || busy !== null}
            recommended={next === 'request-changes'}
            title={
              open === 0
                ? 'Select text in the plan to comment on it first'
                : `Send ${open} ${open === 1 ? 'comment' : 'comments'} back to the agent`
            }
            onClick={() => void requestChanges(plan)}
          >
            <MessageSquareDiff data-icon="inline-start" aria-hidden />
            {busy === 'request-changes' ? 'Sending…' : 'Request changes'}
          </Button>
          <ApprovePlanPopover
            size="xs"
            ownerId={ownerId}
            author={{ agentId: plan.authorAgentId }}
            version={plan.version}
            busy={busy === 'approve'}
            disabled={busy !== null}
            recommended={next === 'approve'}
            onApprove={(mode, to) => approve(plan, mode, to)}
          />
          <Button
            variant="ghost"
            size="xs"
            disabled={busy !== null}
            title="Put this plan aside without waking the agent"
            onClick={() => void dismiss(plan)}
          >
            <X data-icon="inline-start" aria-hidden />
            Dismiss
          </Button>
        </>
      }
    />
  )
}

/**
 * An approved version is in one of two states, and the row says which. While someone works on
 * the conversation it is "Implementing plan vN". When nobody does — the person stopped the run,
 * a turn failed, the app restarted — the work is paused, and the row offers Continue: the plan's
 * resume point (`features/resume`), which hands the plan back to the agent. The point comes from
 * the server, so a plan the agent completed meanwhile offers nothing.
 */
function ApprovedPlanRow({
  sessionId,
  ownerId,
  plan,
}: {
  sessionId: string
  ownerId: string
  plan: SessionPlan
}) {
  const { busy, dismiss } = usePlanDecisions(ownerId)
  const idle = useConversationIdle(sessionId, ownerId)
  // At most one approved version per conversation, so the plan kind names its point.
  const point = useResumePoints(ownerId).find((candidate) => candidate.kind === 'plan')
  const { busyKey, resume } = useResume(ownerId)
  const paused = idle && point !== undefined
  const mode = plan.approvedMode ? PERMISSION_MODE_COPY[plan.approvedMode].label : null
  return (
    <WorkbenchNoticeBar
      role="region"
      aria-label={paused ? 'Plan paused' : 'Plan being implemented'}
      tone={paused ? 'info' : 'success'}
      icon={<ClipboardCheck className="size-3.5" />}
      title={paused ? `Plan v${plan.version} paused` : `Implementing plan v${plan.version}`}
      description={mode ? `${plan.title} · ${mode} mode` : plan.title}
      actionsLabel="Approved plan actions"
      actions={
        <>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => openPlanTab({ sessionId, ownerId, planId: plan.id, title: plan.title })}
          >
            Open
          </Button>
          {paused ? (
            <ContinueButton
              point={point}
              busy={busyKey === point.key}
              disabled={busy !== null}
              onContinue={(target) => void resume(target)}
            />
          ) : null}
        </>
      }
      onDismiss={busy ? undefined : () => void dismiss(plan)}
      dismissLabel="Mark the plan done — the agent stops following it"
    />
  )
}
