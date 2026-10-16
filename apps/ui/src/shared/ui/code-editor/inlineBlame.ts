export interface InlineBlameLine {
  line: number
  author: string
  /** Epoch seconds. */
  authorTime: number
  summary: string
  uncommitted: boolean
  /** Optional provider-owned action that opens this line's history entry. */
  onSelect?: () => void
}

export type InlineBlameSource = (signal: AbortSignal) => Promise<InlineBlameLine[] | null>

const SUMMARY_MAX = 60

export function formatRelativeTime(epochSeconds: number, nowMs: number = Date.now()): string {
  const deltaSeconds = Math.max(0, Math.floor(nowMs / 1000) - epochSeconds)
  if (deltaSeconds < 45) return 'just now'
  const minutes = Math.round(deltaSeconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(deltaSeconds / 3600)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(deltaSeconds / 86_400)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.round(deltaSeconds / (86_400 * 7))
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.round(deltaSeconds / (86_400 * 30))
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.round(deltaSeconds / (86_400 * 365))
  return `${years} year${years === 1 ? '' : 's'} ago`
}

export function formatBlame(info: InlineBlameLine, nowMs: number = Date.now()): string {
  if (info.uncommitted) return 'Not committed yet'
  const author = [info.author, formatRelativeTime(info.authorTime, nowMs)]
    .filter(Boolean)
    .join(', ')
  const summary =
    info.summary.length > SUMMARY_MAX ? `${info.summary.slice(0, SUMMARY_MAX - 1)}…` : info.summary
  return summary ? (author ? `${author} · ${summary}` : summary) : author
}
