import { ChevronDown, ChevronUp, GitMerge } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import type { MergeConflictChoice, MergeConflictRegion } from '../model/mergeConflicts'

export function MergeConflictBar({
  conflict,
  index,
  count,
  onNavigate,
  onResolve,
}: {
  conflict: MergeConflictRegion
  index: number
  count: number
  onNavigate: (index: number) => void
  onResolve: (choice: MergeConflictChoice) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-status-warning/30 bg-status-warning/10 px-3 py-1.5 text-2xs">
      <span className="flex items-center gap-1.5 font-medium text-status-warning">
        <GitMerge className="size-3.5" />
        Conflict {index + 1} of {count}
      </span>
      <span className="max-w-48 truncate text-text-soft" title={conflict.currentLabel}>
        {conflict.currentLabel}
      </span>
      <span className="text-text-faint">↔</span>
      <span className="max-w-48 truncate text-text-soft" title={conflict.incomingLabel}>
        {conflict.incomingLabel}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Action label="Use Current" onClick={() => onResolve('current')} />
        <Action label="Use Incoming" onClick={() => onResolve('incoming')} />
        <Action label="Use Both" onClick={() => onResolve('both')} />
        <IconButton
          size="xs"
          aria-label="Previous conflict"
          tooltip="Previous conflict"
          onClick={() => onNavigate((index - 1 + count) % count)}
        >
          <ChevronUp className="size-3.5" />
        </IconButton>
        <IconButton
          size="xs"
          aria-label="Next conflict"
          tooltip="Next conflict"
          onClick={() => onNavigate((index + 1) % count)}
        >
          <ChevronDown className="size-3.5" />
        </IconButton>
      </div>
    </div>
  )
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm border border-status-warning/35 px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-status-warning/15"
    >
      {label}
    </button>
  )
}
