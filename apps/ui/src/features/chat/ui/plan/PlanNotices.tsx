/**
 * WHAT THE PLAN TAB SAYS ABOVE THE PLAN — the facts about a version that its text cannot carry.
 */
import { ClipboardCheck, FilePen } from 'lucide-react'
import type { SessionPlan } from '@localixai/api/client'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

/**
 * The draft moved on after the newest version — written, not yet presented. The agent edits
 * `PLAN.md` with file tools and nothing announced it, so the person approved v2 while v3 was
 * being written. Quiet and without an action: presenting is the agent's move, not the person's.
 */
export function DraftChangedNotice({ after }: { after: number | undefined }) {
  if (after === undefined) return null
  return (
    <WorkbenchNoticeBar
      role="note"
      aria-label="Draft changed"
      icon={<FilePen className="size-3.5" />}
      title={`The draft changed after v${after} and has not been presented yet.`}
    />
  )
}

/**
 * A completed version opens on what the agent reported. Without it the tab showed the plan text
 * alone, and "was it all done, or did something change on the way" meant scrolling the transcript
 * for the `complete` call.
 */
export function CompletionSummary({ plan }: { plan: SessionPlan }) {
  const summary = plan.status === 'completed' ? plan.completionSummary?.trim() : undefined
  if (!summary) return null
  return (
    <WorkbenchNoticeBar
      role="note"
      aria-label="Completion summary"
      tone="success"
      layout="stacked"
      icon={<ClipboardCheck className="size-3.5" />}
      title={`Completed plan v${plan.version}`}
      description={<span className="whitespace-pre-wrap">{summary}</span>}
    />
  )
}
