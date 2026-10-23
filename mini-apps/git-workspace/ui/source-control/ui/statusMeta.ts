import type { RepoChangeStatus } from '../../../backend/source-control/contracts'

/** Single-letter badge + label + color for each VCS change kind (git-style). */
interface StatusMeta {
  letter: string
  label: string
  /** Tailwind text-color token for the letter badge. */
  color: string
}

const META: Record<RepoChangeStatus, StatusMeta> = {
  modified: { letter: 'M', label: 'Modified', color: 'text-status-warning' },
  added: { letter: 'A', label: 'Added', color: 'text-status-success' },
  deleted: { letter: 'D', label: 'Deleted', color: 'text-status-error' },
  // `--accent-foreground`, not `--accent`: `--accent` is a FILL token, and under the glass theme
  // it is a 6% foreground veil — as a text colour the R/C letters were invisible. Its foreground
  // companion is a real colour in every theme, like every other letter here.
  renamed: { letter: 'R', label: 'Renamed', color: 'text-accent-foreground' },
  copied: { letter: 'C', label: 'Copied', color: 'text-accent-foreground' },
  untracked: { letter: 'U', label: 'Untracked', color: 'text-status-success' },
  conflicted: { letter: '!', label: 'Conflicted', color: 'text-status-error' },
  typechange: { letter: 'T', label: 'Type changed', color: 'text-text-soft' },
  unknown: { letter: '?', label: 'Changed', color: 'text-text-faint' },
}

export function statusMeta(status: RepoChangeStatus): StatusMeta {
  return META[status] ?? META.unknown
}
