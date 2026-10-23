import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { baseName, dirName } from '@localixai/mini-app-sdk/ui/utilities'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { Button } from '@localixai/kit/button'
import type { DocFile } from './document/diffDocument'
import type { DiffNote } from './document/diffRows'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** `+12 −3` — the at-a-glance size of a change. */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 font-mono text-2xs tabular-nums" aria-hidden="true">
      {additions > 0 && <span className="text-status-success">+{additions}</span>}
      {additions > 0 && deletions > 0 && ' '}
      {deletions > 0 && <span className="text-status-error">−{deletions}</span>}
    </span>
  )
}

function fileBadge(file: DocFile): { label: string; tone: string } | null {
  if (file.badge) return { label: file.badge, tone: 'text-text-faint' }
  if (file.deleted) return { label: 'deleted', tone: 'text-status-error' }
  if (file.added) return { label: 'new', tone: 'text-status-success' }
  if (file.binary) return { label: 'binary', tone: 'text-text-faint' }
  return null
}

/**
 * One file's disclosure bar in a multi-file diff. The label is pinned to the
 * viewport (`width`) rather than to the code canvas, so a file name never scrolls
 * away when a long line is scrolled sideways.
 */
export function DiffFileHeader({
  file,
  open,
  width,
  onToggle,
  actions,
}: {
  file: DocFile
  open: boolean
  width: number
  onToggle: () => void
  actions?: ReactNode
}) {
  const label = `${open ? 'Collapse' : 'Expand'} ${file.path}`
  const badge = fileBadge(file)
  const accessibleLabel = [
    label,
    `${plural(file.additions, 'addition')}, ${plural(file.deletions, 'deletion')}`,
    file.deleted ? 'Deleted file' : undefined,
  ]
    .filter(Boolean)
    .join('. ')
  const dir = dirName(file.path)
  return (
    <div className="lx-occluder h-full border-y border-border-soft">
      <div
        style={width ? { width } : undefined}
        className="sticky left-0 flex h-full min-w-0 items-center gap-2 px-2"
      >
        <ActionTooltip label={label}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={accessibleLabel}
            aria-expanded={open}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-xs text-left outline-none focus-ring"
          >
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 text-text-faint transition-transform ${open ? 'rotate-90' : ''}`}
            />
            <span className="min-w-0 truncate font-mono text-2xs">
              <span className="text-foreground">{baseName(file.path)}</span>
              {dir && <span className="text-text-faint"> · {dir}</span>}
            </span>
            {badge && <span className={`shrink-0 text-2xs ${badge.tone}`}>{badge.label}</span>}
            <DiffStat additions={file.additions} deletions={file.deletions} />
          </button>
        </ActionTooltip>
        {actions}
      </div>
    </div>
  )
}

/** Why a file shows no lines: binary, hidden behind the large-diff disclosure, or header-only. */
export function DiffNoteRow({
  file,
  note,
  width,
  onExpand,
}: {
  file: DocFile
  note: DiffNote
  width: number
  onExpand: () => void
}) {
  return (
    <div
      style={width ? { width } : undefined}
      className="sticky left-0 flex h-full items-center gap-2 px-2 pl-7 text-2xs text-text-faint"
    >
      {note === 'binary' && <span>Binary file not shown.</span>}
      {note === 'empty' && (
        <span>
          {file.deleted ? 'File deleted.' : 'No content changes (rename or mode change).'}
        </span>
      )}
      {note === 'large' && (
        <>
          <span>Large diff hidden — {file.lineCount.toLocaleString()} lines.</span>
          <Button variant="ghost" size="xs" onClick={onExpand}>
            Show diff
          </Button>
        </>
      )}
    </div>
  )
}
