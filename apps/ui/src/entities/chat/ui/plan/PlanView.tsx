/**
 * THE PLAN TAB — one per conversation, every version of its plan readable and comparable in it.
 *
 * Why it is shaped this way, defect by defect:
 *
 *   - Comments typed on the old plan lived in browser memory and were dropped unless one specific
 *     button carried them. Here every comment is a server row (`model/planComments.ts`), written
 *     the moment it is added; the strip's "Request changes" sends exactly those rows.
 *   - A revision replaced what the person had commented on. Versions are immutable now, the tab
 *     lists them, and "Changes" diffs the selected one against the version before it.
 *   - Comments of an older version vanished with it. Unsent ones are carried to the new version
 *     or marked `outdated` (`planCommentCarry.ts`), and outdated ones stay listed here.
 *   - A decided version is history: it shows its comments but takes no new ones.
 *   - The agent edits its draft file between presentations, and nothing showed it: the person
 *     approved v2 while v3 was being written. A quiet notice says when the draft moved on.
 *   - A version set aside could not be brought back; the newest one now offers "Back to review".
 *   - Reading a plan here and deciding it in the strip split one act over two places; a presented
 *     version carries the same Approve popover (`ApprovePlanPopover`) in its header.
 *
 * Opened through `openPlanTab` (payload: the owning session, the version to show). Plans are
 * loaded here too, so a tab restored after a reload does not depend on the composer mounting.
 */
import { useCallback, useMemo, useState } from 'react'
import { ClipboardList, FileText, GitCompareArrows } from 'lucide-react'
import type { CommentView, SessionPlan } from '@localixai/api/client'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import type { Comment } from '@localixai/mini-app-sdk/ui/comments'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { WorkItem } from '@/shared/lib/workItem'
import { planCommentScope } from '@/shared/api/plans-client'
import { inspector } from '@/shared/lib/inspectorBus'
import { toast } from '@/shared/lib/notify'
import { CommentsManager } from '@/shared/ui/comments/CommentsManager'
import { TextCommentLayer } from '@/shared/ui/comments/text-comment-layer'
import { VirtualDiff } from '@/shared/ui/diff'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'

import {
  previousVersion,
  reopenablePlan,
  usePlanDraft,
  usePlanDraftRefresh,
  usePlanList,
  usePlansLoaded,
  type PlanTabPayload,
} from '../../model/plans'
import { planCommentActions, usePlanComments } from '../../model/planComments'
import { commentQuote } from '../../model/planCommentCarry'
import { usePlanDecisions } from '../../model/usePlanDecisions'
import { ApprovePlanPopover, planNextStep } from './ApprovePlanPopover'
import { buildPlanDiff } from './planDiff'
import { CompletionSummary, DraftChangedNotice } from './PlanNotices'
import { BackToReviewButton } from './PlanSetAside'
import { PlanVersionMenu } from './PlanVersionMenu'

function readPayload(item: WorkItem): PlanTabPayload | null {
  const ownerId = item.payload?.ownerId
  const planId = item.payload?.planId
  if (typeof ownerId !== 'string') return null
  return { ownerId, planId: typeof planId === 'string' ? planId : undefined }
}

/** A failed write is reported, never swallowed: the comment the person typed did not land. */
function attempt(work: Promise<void>, failure: string): void {
  work.catch((error: unknown) =>
    toast.error(failure, { description: errorMessage(error, '') || undefined }),
  )
}

export function PlanView({ item }: { item: WorkItem }) {
  const payload = readPayload(item)
  const ownerId = payload?.ownerId ?? null
  usePlansLoaded(ownerId)
  const plans = usePlanList(ownerId)
  const latest = plans[0]
  usePlanDraftRefresh(ownerId, useWorkItemVisible(), `${latest?.id}:${latest?.status}`)
  const draft = usePlanDraft(ownerId)

  // The version follows the payload — a reopen from the strip or a tool card names one — and
  // otherwise the person's own pick inside the tab.
  const [picked, setPicked] = useState<{ from?: string; id?: string }>({})
  const requested = payload?.planId
  const selectedId = picked.from === requested ? (picked.id ?? requested) : requested
  const plan = plans.find((candidate) => candidate.id === selectedId) ?? plans[0]

  if (!ownerId) return <EmptyHint>This plan tab has no conversation.</EmptyHint>
  if (!plan) return <EmptyHint>No plan yet.</EmptyHint>
  return (
    <PlanVersionView
      key={plan.id}
      ownerId={ownerId}
      plans={plans}
      plan={plan}
      draftChangedAfter={draft?.changed ? latest?.version : undefined}
      fileSessionId={item.scope ?? ownerId}
      onPick={(id) => setPicked({ from: requested, id })}
    />
  )
}

function PlanVersionView({
  ownerId,
  plans,
  plan,
  draftChangedAfter,
  fileSessionId,
  onPick,
}: {
  ownerId: string
  plans: readonly SessionPlan[]
  plan: SessionPlan
  draftChangedAfter: number | undefined
  /** The conversation the tab was opened from: a snapshot file opens in its workspace. */
  fileSessionId: string
  onPick: (planId: string) => void
}) {
  const visible = useWorkItemVisible()
  const previous = previousVersion(plans, plan)
  const diff = useMemo(() => buildPlanDiff(previous, plan), [previous, plan])
  const [view, setView] = useState<'plan' | 'changes'>('plan')
  const showChanges = view === 'changes' && diff !== null
  const editable = plan.status === 'presented'

  const comments = usePlanComments(plan.id)
  // The version before this one may hold comments that could not follow it here.
  const earlier = usePlanComments(previous?.id)
  const { busy, requestChanges, approve } = usePlanDecisions(ownerId)

  // On a decided version every comment still points at text it holds, outdated ones included.
  const placed = useMemo(
    () =>
      comments
        .filter((comment) => !editable || comment.status !== 'outdated')
        .map((comment) => ({ id: comment.id, quote: commentQuote(comment), note: comment.body })),
    [comments, editable],
  )
  const listed = useMemo(
    () => [
      ...comments.filter((comment) => comment.status !== 'sent'),
      ...earlier.filter((comment) => comment.status === 'outdated'),
    ],
    [comments, earlier],
  )
  const byId = useMemo(
    () => new Map(listed.concat(comments).map((comment) => [comment.id, comment])),
    [listed, comments],
  )

  const onAdd = useCallback(
    (quote: string, note: string) =>
      attempt(planCommentActions.add(plan.id, quote, note), 'Could not save the comment'),
    [plan.id],
  )
  const onUpdate = useCallback(
    (id: string, note: string) => {
      const comment = byId.get(id)
      if (comment) attempt(planCommentActions.edit(comment, note), 'Could not save the comment')
    },
    [byId],
  )
  const onRemove = useCallback(
    (id: string) => {
      const comment = byId.get(id)
      if (comment) attempt(planCommentActions.remove(comment), 'Could not delete the comment')
    },
    [byId],
  )
  const openCount = comments.filter((comment) => comment.status === 'open').length
  const next = planNextStep(editable, openCount)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        tone="content"
        icon={<ClipboardList className="size-3.5" />}
        title={
          <span className="min-w-0 truncate text-xs text-text-strong" title={plan.title}>
            {plan.title}
          </span>
        }
        actionsLabel="Plan view"
        actions={
          <>
            <CommentsManager
              comments={listed.map((comment) => toManagerComment(comment, plan))}
              submitLabel="Request changes"
              submitting={busy === 'request-changes'}
              onSubmit={editable && openCount > 0 ? () => void requestChanges(plan) : undefined}
              recommendSubmit={next === 'request-changes' && busy === null}
              onRemove={onRemove}
              onClear={() => listed.forEach((comment) => onRemove(comment.id))}
            />
            {diff && (
              <SegmentedControl variant="muted" aria-label="Plan view">
                <SegmentedControlItem
                  active={!showChanges}
                  onClick={() => setView('plan')}
                  title="Read this version"
                >
                  <FileText className="size-3.5" /> Plan
                </SegmentedControlItem>
                <SegmentedControlItem
                  active={showChanges}
                  onClick={() => setView('changes')}
                  title={`Compare with v${previous?.version}`}
                >
                  <GitCompareArrows className="size-3.5" /> Changes
                </SegmentedControlItem>
              </SegmentedControl>
            )}
            {reopenablePlan(plans)?.id === plan.id && (
              <BackToReviewButton ownerId={ownerId} plan={plan} />
            )}
            {editable && (
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
            )}
            <PlanVersionMenu
              plans={plans}
              current={plan}
              onPick={onPick}
              onOpenFile={(path) => inspector.openFile({ sessionId: fileSessionId, path })}
            />
          </>
        }
      />
      <DraftChangedNotice after={draftChangedAfter} />
      <CompletionSummary plan={plan} />
      <TextCommentLayer
        comments={placed}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onRemove={onRemove}
        readOnly={!editable}
        attachments={false}
        active={visible && !showChanges}
        className={cn('min-h-0 flex-1 px-4 py-4', showChanges && 'hidden')}
      >
        <MarkdownRenderer>{plan.body}</MarkdownRenderer>
      </TextCommentLayer>
      {showChanges && diff ? (
        <VirtualDiff
          doc={diff}
          ariaLabel="Changes since the previous version"
          className="min-h-0 flex-1"
        />
      ) : null}
    </div>
  )
}

/** The shared comments list speaks anchors and groups; a plan comment's group is its state. */
function toManagerComment(comment: CommentView, plan: SessionPlan): Comment {
  const outdated = comment.status === 'outdated'
  const ownVersion = comment.scope === planCommentScope(plan.id)
  return {
    id: comment.id,
    scope: comment.scope,
    body: comment.body,
    anchor: {
      kind: 'plan',
      targetId: comment.id,
      label: outdated ? 'Outdated' : 'Comment',
      groupId: outdated ? 'outdated' : 'open',
      groupLabel: outdated
        ? ownVersion
          ? 'Outdated — the text is not in the newer version'
          : 'Outdated — from the previous version'
        : 'To send with Request changes',
      context: commentQuote(comment),
    },
  }
}
