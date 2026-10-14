import type { Dispatch, SetStateAction } from 'react'
import { ChevronRight } from 'lucide-react'
import { WorkbenchSash } from '@localixai/kit/button'
import { SectionLabel } from '@localixai/kit/section-label'
import type { CommitsPaneResize } from '../model/useCommitsPane'
import { CommitGraph } from './CommitGraph'

interface CommitsPaneProps {
  sessionId: string
  repoRoot?: string
  commitsOpen: boolean
  setCommitsOpen: Dispatch<SetStateAction<boolean>>
  resize: CommitsPaneResize
  /** Click/keyboard-select a commit to open its full diff. */
  onSelectCommit?: (hash: string) => void
  /** Compare two commits (`from` marked base → `to`); opens a range diff. */
  onCompare?: (from: string, to: string) => void
}

/**
 * Collapsible commit-log pane at the bottom of the Source Control panel — its own
 * scroll, with the shared workbench sash above it. The header is the same recipe as
 * every `CollapsibleSection` header above it (label, chevron, hover, focus ring); it
 * used to be a lookalike with its own tracking and a hover tint but no focus
 * indicator.
 */
export function CommitsPane({
  sessionId,
  repoRoot,
  commitsOpen,
  setCommitsOpen,
  resize,
  onSelectCommit,
  onCompare,
}: CommitsPaneProps) {
  return (
    <div
      className="flex shrink-0 flex-col border-t border-border"
      style={commitsOpen ? { height: resize.size } : undefined}
    >
      {commitsOpen && (
        <WorkbenchSash
          label="Resize commit log"
          orientation="horizontal"
          resetLabel="restore the default height"
          valueMin={resize.min}
          valueMax={resize.limit}
          valueNow={resize.size}
          valueText={`${Math.round(resize.size)} pixels`}
          active={resize.resizing}
          onPointerDown={resize.onResizeStart}
          onKeyDown={resize.onResizeKeyDown}
          onDoubleClick={resize.reset}
          className="relative -mt-px w-full"
        />
      )}
      <button
        type="button"
        onClick={() => setCommitsOpen((open) => !open)}
        aria-expanded={commitsOpen}
        className="flex shrink-0 cursor-pointer items-center gap-1.5 px-2 py-1 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-surface-hover focus-ring"
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-text-faint transition-transform ${commitsOpen ? 'rotate-90' : ''}`}
        />
        <SectionLabel as="span" weight="semibold">
          Commits
        </SectionLabel>
      </button>
      {commitsOpen && (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <CommitGraph
            key={`${sessionId}:${repoRoot ?? ''}`}
            sessionId={sessionId}
            onSelectCommit={onSelectCommit}
            onCompare={onCompare}
          />
        </div>
      )}
    </div>
  )
}
