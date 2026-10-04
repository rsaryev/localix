import { GitCompare, FileText } from 'lucide-react'
import type { FileChange } from '@localixai/agent/agents'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { firstChangedLine } from '@/shared/ui/diff'
import { MetadataTooltip } from '@localixai/kit/tooltip'
import { DiffStat, FileLink, ToolHeaderAction } from '../ToolIO'
import { baseName } from './format'
import { sumDiffStats } from './fileChangeFormat'

const KIND_LABEL: Record<FileChange['kind'], string> = {
  add: 'new',
  modify: 'edit',
  delete: 'del',
  rename: 'rename',
}
const KIND_TITLE: Record<FileChange['kind'], string> = {
  add: 'New file',
  modify: 'Edited file',
  delete: 'Deleted file',
  rename: 'Renamed file',
}

/**
 * One flat row in the multi-file file-change body. A failed file (partial
 * apply_patch) uses a status-colored track with the reason and no Open/Diff
 * actions (nothing was written); an applied file shows its kind, diff stat, and
 * inspector actions without nesting another card in the tool body.
 */
export function FileChangeRow({ change }: { change: FileChange }) {
  // The transcript's chat: Open/Diff land in the workspace of the chat that made the change.
  const sessionId = useWorkItemSessionId()
  if (change.failed) {
    return (
      <div className="flex items-start justify-between gap-3 border-l-2 border-l-status-error/45 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <FileLink path={change.path} />
          {change.failReason && (
            <MetadataTooltip label={change.failReason} align="start">
              <p className="mt-0.5 line-clamp-2 text-2xs text-status-error/90">
                {change.failReason}
              </p>
            </MetadataTooltip>
          )}
        </div>
        <MetadataTooltip label="This file was not applied">
          <span className="shrink-0 py-0.5 text-2xs font-medium text-status-error">failed</span>
        </MetadataTooltip>
      </div>
    )
  }

  const stats = sumDiffStats([change])
  return (
    <div className="flex items-center justify-between gap-3 border-l-2 border-l-border-soft px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <FileLink path={change.path} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-2xs">
        <MetadataTooltip label={KIND_TITLE[change.kind]}>
          <span className="py-0.5 text-text-faint">{KIND_LABEL[change.kind]}</span>
        </MetadataTooltip>
        <DiffStat additions={stats.additions} deletions={stats.deletions} />
        {sessionId && change.kind !== 'delete' && (
          <ToolHeaderAction
            icon={FileText}
            label="Open"
            onClick={() =>
              inspector.openFile({
                sessionId,
                path: change.path,
                line: change.diff ? firstChangedLine(change.diff) : undefined,
              })
            }
          />
        )}
        {sessionId && change.diff && (
          <ToolHeaderAction
            icon={GitCompare}
            label="Diff"
            onClick={() =>
              inspector.openDiff({
                sessionId,
                path: change.path,
                diff: change.diff!,
                title: baseName(change.path),
                deleted: change.kind === 'delete',
              })
            }
          />
        )}
      </div>
    </div>
  )
}
