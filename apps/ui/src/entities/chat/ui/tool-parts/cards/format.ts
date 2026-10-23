/** Tiny formatting helpers shared by the tool cards. Pure, no React. */

// Re-export the canonical, tested SDK path helper so the tool
// cards have a single source of truth for "last path segment" rather than a
// near-duplicate local copy.
export { baseName } from '@localixai/mini-app-sdk/ui/utilities'

/** Human bytes: 532 B / 4.2 KB / 1.3 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Number of non-empty lines in a block of text. */
export function countNonEmptyLines(text: string): number {
  if (!text) return 0
  return text.split('\n').filter((l) => l.trim().length > 0).length
}

/** Truncate with ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Read `obj[key]` as a string when it is one. */
export function strField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

/** Read `obj[key]` as a number when it is one. */
export function numField(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : undefined
}

/** Cast an unknown payload to a record for field access (undefined otherwise). */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/** Pretty JSON for IN/OUT display (string passthrough). */
export function pretty(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}
