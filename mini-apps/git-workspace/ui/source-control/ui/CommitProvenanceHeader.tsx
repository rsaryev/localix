import { GitBranch } from 'lucide-react'
import { formatTimeAgo } from '@localixai/mini-app-sdk/ui/utilities'

export interface CommitProvenance {
  model?: string
  agentMode?: string
  createdAt?: string
  rationale?: string
}

/**
 * Provenance strip rendered ABOVE a commit diff when the commit carries a localix
 * git note (made through our own commit path). Monochrome, design-tokens only —
 * "⎇ agent commit · <model> · <mode> · <relative time>" with an optional rationale
 * line. Renders nothing when there is no provenance.
 */
export function CommitProvenanceHeader({ provenance }: { provenance: CommitProvenance }) {
  const parts = [
    provenance.model,
    provenance.agentMode,
    provenance.createdAt ? formatTimeAgo(Date.parse(provenance.createdAt)) : null,
  ].filter(Boolean) as string[]

  return (
    // A hairline and no fill: `bg-surface-raised` mixes from a darker ground than the diff
    // pane, so this strip read as a black bar above the code under glass.
    <div className="shrink-0 border-b border-border-soft px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-2xs text-text-faint">
        <GitBranch className="size-3 shrink-0" aria-hidden />
        <span className="font-medium text-text-soft">agent commit</span>
        {parts.length > 0 && <span className="truncate">· {parts.join(' · ')}</span>}
      </div>
      {provenance.rationale && (
        <div className="mt-0.5 truncate text-2xs text-text-faint" title={provenance.rationale}>
          {provenance.rationale}
        </div>
      )}
    </div>
  )
}
