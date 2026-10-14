import { isAtOrUnder } from '@localixai/path-containment/ancestry'
export { scoreSearchFields, type SearchField, type ScoreSearchOptions } from '@localixai/search'
export {
  matchPositions,
  positionalMatch,
  type MatchKind,
  type PositionalMatch,
} from '@localixai/search/positions'
export { inertLine } from '../terminal-text'
export { shellQuote } from '../shell-quote'

const usdFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const tokenFormatter = new Intl.NumberFormat('en-US')

/** Pull a human-readable message out of an unknown thrown value. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const value = error as { message?: unknown; error?: { message?: unknown } }
    if (typeof value.message === 'string' && value.message) return value.message
    if (typeof value.error?.message === 'string' && value.error.message) {
      return value.error.message
    }
  }
  if (typeof error === 'string' && error) return error
  return fallback
}

export function formatFileSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatUsd(usd: number): string {
  if (!usd) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usdFormatter.format(usd)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return tokenFormatter.format(tokens)
}

/** Trim a model id like `openrouter/deepseek/deepseek-v4` to its useful tail. */
export function shortKey(key: string): string {
  if (!key || key === 'unknown') return 'unknown'
  const parts = key.split('/')
  return parts.length > 1 ? parts.slice(-2).join('/') : key
}

/** Trend bucket key (`YYYY-MM-DD` or `YYYY-MM-DDTHH`) to a compact local label. */
export function formatBucketLabel(bucket: string): string {
  if (!bucket) return ''
  const [datePart, hourPart] = bucket.split('T')
  const date = new Date(`${datePart}T00:00:00`)
  if (Number.isNaN(date.getTime())) return bucket
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return hourPart === undefined ? day : `${day} ${hourPart.padStart(2, '0')}:00`
}

export function formatElapsed(milliseconds: number): string {
  if (milliseconds <= 0) return '0s'
  if (milliseconds < 1000) return `${milliseconds}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.round((milliseconds % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

// Built once: `toLocaleDateString` with options constructs a new `Intl.DateTimeFormat` on every
// call, and a sidebar row older than a week calls this on every render.
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (seconds < 60) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return SHORT_DATE.format(new Date(timestamp))
}

export function formatTimeAgo(timestamp: number): string {
  const elapsed = Date.now() - timestamp
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds == null || milliseconds <= 0) return '—'
  if (milliseconds < 1000) return `${milliseconds}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`
  const totalSeconds = Math.round(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function baseName(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

export function dirName(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

export function relativePath(root: string, absolutePath: string): string {
  if (!root) return absolutePath
  if (absolutePath === root) return baseName(absolutePath)
  if (!isAtOrUnder(root, absolutePath)) return absolutePath
  const base = root.endsWith('/') ? root : `${root}/`
  return absolutePath.slice(base.length)
}

export interface PointerPoint {
  x: number
  y: number
}

export const ROW_CLICK_MAX_TRAVEL_PX = 6

export function isRowSelectClick(
  down: PointerPoint | null,
  up: PointerPoint,
  dragged: boolean,
  maxTravel: number = ROW_CLICK_MAX_TRAVEL_PX,
): boolean {
  if (dragged) return false
  if (!down) return true
  return Math.hypot(up.x - down.x, up.y - down.y) <= maxTravel
}

export function findLast<T>(
  items: readonly T[],
  predicate: (item: T, index: number) => boolean,
): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (predicate(item, index)) return item
  }
  return undefined
}

/**
 * Return a NEW Set with `value` toggled — added if absent, removed if present.
 *
 * Immutable, so it drops straight into `setState(prev => toggleInSet(prev, v))`. It is the reducer
 * behind every collapse/selection Set in the workbench, and a plugin rendering a tree needs the
 * same one rather than reaching into host `shared/lib` for a four-line generic.
 */
export function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
