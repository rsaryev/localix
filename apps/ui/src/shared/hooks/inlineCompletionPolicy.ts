import type { InlineCompletionSurfaceId } from '@localixai/api/client'

export const INLINE_COMPLETION_MAX_RETRIES = 2

export interface InlineCompletionRetryBudget {
  key: string
  attempts: number
}

/**
 * Decide whether a transient failure for `key` earns another attempt, and return the budget to
 * remember. A different key means a different draft, which starts over.
 */
export function planInlineCompletionRetry(
  previous: InlineCompletionRetryBudget | null,
  key: string,
  maxRetries: number = INLINE_COMPLETION_MAX_RETRIES,
): { retry: boolean; budget: InlineCompletionRetryBudget } {
  const attempts = previous?.key === key ? previous.attempts : 0
  if (attempts >= maxRetries) return { retry: false, budget: { key, attempts } }
  return { retry: true, budget: { key, attempts: attempts + 1 } }
}

/**
 * Whether a failed request is worth a timed retry. Only a transient server outcome is.
 *
 * A cancellation arrives as a rejection too, and two kinds carry no `code`: the hub aborting a
 * call because ANOTHER surface's newer offer superseded it, and the socket's own abort. Both
 * reached the retry path, so a chat draft that did nothing wrong spent its budget and fired a
 * second model call 30 s later for an answer the superseding call had already delivered.
 */
export function shouldRetryInlineCompletion(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false
  const code = (error as { code?: unknown } | null)?.code
  return !['cancelled', 'disabled', 'no_model'].includes(typeof code === 'string' ? code : '')
}

export function inlineCompletionKey(
  sessionId: string | null,
  surface: InlineCompletionSurfaceId,
  contextKey: string,
  value: string,
): string {
  return JSON.stringify([sessionId ?? '', surface, contextKey, value])
}

export function canRequestInlineCompletion(
  eligible: boolean,
  key: string,
  blockedKey: string | null,
): boolean {
  return eligible && blockedKey !== key
}

/** A late reply survives only exact prefix typing in the same session and context. */
export function projectInlineCompletionDelivery(
  deliveryKey: string | undefined,
  currentKey: string,
  suffix: string,
): { baseValue: string; suffix: string } | null {
  if (!deliveryKey || !suffix.trim()) return null
  try {
    const before: unknown = JSON.parse(deliveryKey)
    const current: unknown = JSON.parse(currentKey)
    if (
      !Array.isArray(before) ||
      !Array.isArray(current) ||
      before.length !== 4 ||
      current.length !== 4
    )
      return null
    if (before.slice(0, 3).some((value, i) => value !== current[i])) return null
    const base = before[3]
    const value = current[3]
    if (
      typeof base !== 'string' ||
      typeof value !== 'string' ||
      !value.startsWith(base) ||
      !(base + suffix).startsWith(value)
    )
      return null
    return { baseValue: value, suffix: (base + suffix).slice(value.length) }
  } catch {
    return null
  }
}

export function inlineCompletionAcceptance(
  suggestion: string,
  unit: 'all' | 'word' | 'line',
): string {
  if (unit === 'word') return suggestion.match(/^\s*\S+\s*/u)?.[0] ?? suggestion
  if (unit === 'line') return suggestion.slice(0, suggestion.indexOf('\n') + 1 || suggestion.length)
  return suggestion
}

export interface InlineCompletionController {
  /** Append-only ghost text, including any required joining whitespace. */
  suggestion: string
  accept: (unit?: 'all' | 'word' | 'line') => boolean
  dismiss: () => boolean
  request: () => boolean
  handleCompositionStart: () => void
  handleCompositionEnd: () => void
  /** Tab accepts and Escape dismisses. True means the event was consumed. */
  handleKeyDown: (event: React.KeyboardEvent) => boolean
}

export interface ResolvedInlineCompletion {
  key: string
  sessionId: string | null
  surface: InlineCompletionSurfaceId
  contextKey: string
  baseValue: string
  suffix: string
}

export interface InlineCompletionProjection {
  /** Current text is still an append-only prefix of the installed completion. */
  covered: boolean
  /** The remaining ghost suffix; empty when the user typed the target in full. */
  suggestion: string
}

/**
 * Project one installed completion onto a newer draft without another model
 * call. Only append-only, same-context typing qualifies; deletion before the
 * original base or divergent text invalidates it.
 */
export function projectInlineCompletion(
  resolved: ResolvedInlineCompletion | null,
  current: {
    sessionId: string | null
    surface: InlineCompletionSurfaceId
    contextKey: string
    value: string
  },
): InlineCompletionProjection {
  if (
    !resolved ||
    resolved.sessionId !== current.sessionId ||
    resolved.surface !== current.surface ||
    resolved.contextKey !== current.contextKey ||
    !current.value.startsWith(resolved.baseValue)
  )
    return { covered: false, suggestion: '' }

  const target = `${resolved.baseValue}${resolved.suffix}`
  if (!target.startsWith(current.value)) return { covered: false, suggestion: '' }
  return { covered: true, suggestion: target.slice(current.value.length) }
}
