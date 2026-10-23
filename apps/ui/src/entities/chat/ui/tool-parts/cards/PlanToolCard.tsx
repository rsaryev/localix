/**
 * The `plan` call in the transcript: what the call did to the conversation's plan, and a way back
 * to it.
 *
 * Without the Open action a plan whose tab was closed could only be found again through the
 * composer strip — and once it was decided the strip no longer shows it, so an old version was
 * unreachable from the place that announced it. The card opens the conversation's one plan tab at
 * the version this call touched.
 *
 * `plan` has three actions (`planCallFormat.ts`). A presentation and a completion are moments the
 * person acts on, so they carry Open (and a completion its summary, in the body); a read changes
 * nothing, so it stays one compact line with no action.
 */
import { ClipboardCheck, ClipboardList, PanelRight } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'

import { openPlanTab, usePlanOwnerId } from '../../../model/plans'
import { ToolLine } from '../ToolLine'
import { ToolBody, ToolHeaderAction } from '../ToolIO'
import { hasItemError, isItemDeclined, isItemStreaming, itemErrorHeadline } from '../itemHelpers'
import { planCallShape, planCallSubtitle } from './planCallFormat'

export function PlanToolCard({ item }: { item: ToolCallItem }) {
  const sessionId = useWorkItemSessionId()
  const ownerId = usePlanOwnerId(sessionId)
  const shape = planCallShape(item)
  const title = shape.title ?? 'Plan'
  const hasError = hasItemError(item)
  const streaming = isItemStreaming(item)
  const opensPlan = shape.action !== 'read' && sessionId && ownerId && !hasError && !streaming

  return (
    <ToolLine
      icon={shape.action === 'complete' ? ClipboardCheck : ClipboardList}
      title={title}
      subtitle={itemErrorHeadline(item) ?? (hasError ? 'Failed' : planCallSubtitle(shape))}
      isLoading={streaming}
      hasError={hasError}
      isDismissed={isItemDeclined(item)}
      headerActions={
        opensPlan ? (
          <ToolHeaderAction
            icon={PanelRight}
            label="Open plan"
            onClick={() =>
              // Without loaded details the tab opens on the newest version, which lists the rest.
              openPlanTab({ sessionId, ownerId, planId: shape.plan?.id, title })
            }
          />
        ) : undefined
      }
    >
      {shape.action === 'complete' && shape.summary && !hasError ? (
        <ToolBody>
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-text-soft">
            {shape.summary}
          </p>
        </ToolBody>
      ) : undefined}
    </ToolLine>
  )
}
