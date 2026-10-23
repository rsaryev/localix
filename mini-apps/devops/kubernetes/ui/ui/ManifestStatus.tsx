import { CircleCheck } from 'lucide-react'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import type { ManifestEditorModel } from '../model/useManifestEditor'

export function ManifestStatus({
  subject,
  model,
}: {
  /** Which manifest — the identity `ManifestView` owns for every state of this pane. */
  subject: string
  model: ManifestEditorModel
}) {
  // A refresh that failed while the last manifest is still on screen is STALE, not blocked.
  const stale = !model.applyError && Boolean(model.loadIssue && model.original)
  const issue = model.applyError
    ? { message: model.applyError }
    : stale
      ? (model.loadIssue ?? null)
      : null

  return (
    <>
      {/* Mounted unconditionally: the Event Center row settles only when the owner is handed
          `null`, which a `{error && …}` can never do — it unmounts as the failure ends. */}
      <DevOpsProblem
        subject={subject}
        title={
          stale
            ? model.notice
              ? 'Applied, but the refresh failed — this is the manifest you submitted.'
              : // No "showing the last loaded manifest": `stale` already says that on the line.
                'The refresh failed.'
            : undefined
        }
        issue={issue}
        onRetry={stale && model.canRefresh ? () => void model.refresh() : undefined}
      />
      {!issue && model.notice && (
        <WorkbenchNoticeBar
          role="status"
          tone="success"
          icon={<CircleCheck className="size-3.5" />}
          title={model.notice}
        />
      )}
    </>
  )
}
