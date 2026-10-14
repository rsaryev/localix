import { memo } from 'react'
import { Check, Plus, Minus } from 'lucide-react'
import type { RepoFileChange } from '../../../backend/source-control/contracts'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import type { ChangeActions } from '../model/changeActions'
import type { ChangeGroups } from '../model/changeGroups'
import { ChangesTree } from './changes-tree/ChangesTree'
import { BulkAction } from './sourceControlParts'

/**
 * The flat (one-repo) Changes layout: **Merge Changes** ahead of **Staged Changes** and
 * **Changes**, each a collapsible section over its own tree — or the clean-tree line.
 * Memoized, with stable handlers from the tab, so a poll that changed nothing renders nothing.
 */
export const SingleRepoChanges = memo(function SingleRepoChanges({
  groups,
  empty,
  selectedPath,
  actions,
  onOpen,
  onStageAll,
  onUnstageAll,
}: {
  groups: ChangeGroups
  /** The working tree has no changes at all. */
  empty: boolean
  selectedPath: string | null
  actions: ChangeActions
  onOpen: (file: RepoFileChange, staged: boolean) => void
  onStageAll: (paths: string[]) => void
  onUnstageAll: (paths: string[]) => void
}) {
  const { conflicts, staged, changed } = groups
  if (empty) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-faint">
        <Check className="size-3.5 shrink-0 text-status-success/80" />
        <span>No changes — working tree clean.</span>
      </div>
    )
  }
  return (
    <>
      {conflicts.length > 0 && (
        <CollapsibleSection title="Merge Changes" count={conflicts.length}>
          <ChangesTree
            files={conflicts}
            group="conflict"
            selectedPath={selectedPath}
            actions={actions}
            onOpen={onOpen}
          />
        </CollapsibleSection>
      )}
      {staged.length > 0 && (
        <CollapsibleSection
          title="Staged Changes"
          count={staged.length}
          actions={
            <BulkAction title="Unstage all" onClick={() => onUnstageAll(staged.map((f) => f.path))}>
              <Minus className="size-3.5" />
            </BulkAction>
          }
        >
          <ChangesTree
            files={staged}
            group="staged"
            selectedPath={selectedPath}
            actions={actions}
            onOpen={onOpen}
          />
        </CollapsibleSection>
      )}
      {changed.length > 0 && (
        <CollapsibleSection
          title="Changes"
          count={changed.length}
          actions={
            <BulkAction title="Stage all" onClick={() => onStageAll(changed.map((f) => f.path))}>
              <Plus className="size-3.5" />
            </BulkAction>
          }
        >
          <ChangesTree
            files={changed}
            group="unstaged"
            selectedPath={selectedPath}
            actions={actions}
            onOpen={onOpen}
          />
        </CollapsibleSection>
      )}
    </>
  )
})
