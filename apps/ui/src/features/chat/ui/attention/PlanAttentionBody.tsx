/**
 * A plan presented in a chat the person is not in — decided here, read in its tab.
 *
 * A presented plan used to reach no cross-session surface at all: the author stopped and waited,
 * and unless the person happened to open that chat nothing told them a decision was owed. So this
 * body carries enough to decide on the spot — who presented which version, its title, the first
 * lines of its body — and the same decisions the composer strip offers: Approve ▾ (which is also
 * the mode and the agent who starts, `ApprovePlanPopover`), Set aside, or
 * Open plan to read all of it first.
 * Request changes is deliberately absent: it sends the comments made ON the plan, which only
 * exist once the person has read it in its tab. So the suggested step (`planNextStep`) is Approve
 * on a version without open comments, and Open plan — where they are sent — on one with some.
 */
import { ArrowUpRight, ClipboardList, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'

import { openPlanTab } from '@/features/chat/model/plans'
import { usePlanDecisions } from '@/features/chat/model/usePlanDecisions'
import { openComments, usePlanComments } from '@/features/chat/model/planComments'
import { ApprovePlanPopover, planNextStep } from '../plan/ApprovePlanPopover'
import type { AttentionBodyProps } from './types'

/** How much of the plan the dialog quotes; the tab has the rest. */
export const PLAN_EXCERPT_LINES = 6

/** The first lines of a plan's body, marked as cut when there is more. */
export function planExcerpt(body: string | undefined): string {
  const lines = (body ?? '').trim().split('\n')
  const head = lines.slice(0, PLAN_EXCERPT_LINES).join('\n')
  return lines.length > PLAN_EXCERPT_LINES ? `${head}\n…` : head
}

export function PlanAttentionBody({
  item,
  session,
  sessionTitle,
  openChat,
  settle,
}: AttentionBodyProps) {
  // Plans belong to the ROOT session, which is what every plan call is addressed to.
  const ownerId = session?.rootSessionId ?? item.sessionId
  const { busy, approve, dismiss } = usePlanDecisions(ownerId)
  const planId = item.subject.planId
  const version = item.subject.version
  const handle = item.subject.agentHandle
  const excerpt = planExcerpt(item.summary)
  // Request changes lives in the tab, so with open comments the step is going there to send them.
  const next = planNextStep(true, openComments(usePlanComments(planId)).length)

  // A recorded decision settles the item here at once; a failed one keeps it (its toast says why).
  // It answers the outcome too, so the approve popover closes only on a recorded decision.
  const decide = async (act: (plan: { id: string }) => Promise<boolean>): Promise<boolean> => {
    if (!planId) return false
    const recorded = await act({ id: planId })
    if (recorded) settle()
    return recorded
  }

  const openPlan = () => {
    openChat()
    if (planId) openPlanTab({ sessionId: item.sessionId, ownerId, planId, title: item.title })
  }

  return (
    <DialogContent size="md" aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle className="flex min-w-0 items-center gap-1.5 text-2xs font-medium">
          <ClipboardList className="size-3.5 shrink-0 text-status-info" aria-hidden />
          <span className="truncate text-text-soft">{sessionTitle}</span>
          <span className="shrink-0 font-normal text-text-faint">
            — {handle ? `@${handle}` : 'the agent'} presented plan
            {version ? ` v${version}` : ''}
          </span>
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-2">
        <p className="text-sm font-medium text-text-strong">{item.title}</p>
        {excerpt ? (
          <p className="line-clamp-6 text-xs leading-relaxed whitespace-pre-wrap text-text-soft">
            {excerpt}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          disabled={!planId || busy !== null}
          title="Put this plan aside without waking the agent"
          onClick={() => void decide(dismiss)}
        >
          <X data-icon="inline-start" aria-hidden />
          Set aside
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={openPlan}
          recommended={next === 'request-changes' && busy === null}
        >
          Open plan
          <ArrowUpRight data-icon="inline-end" aria-hidden />
        </Button>
        <ApprovePlanPopover
          ownerId={ownerId}
          author={{ handle }}
          version={version}
          busy={busy === 'approve'}
          disabled={!planId || busy !== null}
          recommended={next === 'approve'}
          onApprove={(mode, to) => decide((plan) => approve(plan, mode, to))}
        />
      </DialogFooter>
    </DialogContent>
  )
}
