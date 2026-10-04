import type { LiveFileChangeRequest } from '@/shared/lib/inspectorBus'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { CodeEditor } from '@/shared/ui/code-editor/CodeEditor'
import { languageFromPath } from '@/shared/ui/diff'
import { LivePatchDiff } from './LivePatchDiff'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'

/**
 * Live in-progress write/edit/apply_patch stream.
 *
 * A `patch` streams a MULTI-FILE diff — it's rendered as a clean per-file diff via
 * `LivePatchDiff` (the raw `*** Update File:` / `@@` envelope would just read as noise).
 * A `write`/`edit` streams a single file's content, rendered through the SAME read-only
 * Monaco-backed `CodeEditor` the settled file viewer uses — identical gutter, line
 * numbers, font, and theme — so the stream→settled transition is seamless. `followTail`
 * keeps the write head in view; a quiet tool row marks it as in-flight.
 */
export function LiveFileChangeTab({ change }: { change: LiveFileChangeRequest }) {
  if (change.mode === 'patch') {
    return <LivePatchDiff code={change.code} />
  }
  if (!change.code) {
    return (
      <div className="flex min-h-24 items-center justify-center px-4 py-3 text-xs text-text-faint">
        <ActivitySignal label="Preparing file" />
      </div>
    )
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkbenchToolbar density="slim" aria-label="Live file change status">
        <WorkbenchToolbarSection align="end">
          <ActivitySignal label="Live file changes" className="text-2xs text-status-info" />
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={change.code}
          language={change.path ? languageFromPath(change.path) : undefined}
          readOnly
          followTail
          ariaLabel="Live file changes"
        />
      </div>
    </div>
  )
}
