import type { ResolvedInput } from './browser-input'

/**
 * A tab that was typed a vault secret is "tainted": the string shield cannot cover what it can
 * still show or compute. A screenshot may show the value as pixels (a plain text field, a "show
 * password" toggle) and goes to a vision model; `evaluate` can split, reverse or encode the value
 * so exact-match redaction misses it. Snapshots and `read` text stay allowed (they are shielded).
 *
 * The taint lasts until the tab is seen at another URL. A tab whose URL was never learned stays
 * tainted for the run. A call without a `preview_id` could be any tab, so it meets every taint.
 */
export const TAINT_REFUSAL =
  'Refused: a stored secret was typed into this tab, and a screenshot or `evaluate` could expose it (pixels, or a transformed copy the shield cannot recognise). Navigate the tab to another page first (action="steps" or "open" with a different URL), read it with snapshot or read instead, or ask the person to check the page.'

const hasEvaluateStep = (input: ResolvedInput) =>
  !!input.steps?.some((step) => step.action === 'evaluate')

/** The calls a tainted tab refuses. */
export const isTaintSensitive = (input: ResolvedInput) =>
  input.action === 'take_screenshot' || input.action === 'evaluate' || hasEvaluateStep(input)

export interface TabTaint {
  /** True when this call would show or compute on a tab that holds a typed secret. */
  refuses(input: ResolvedInput): boolean
  /** A call finished: learn the tab's URL, lift the taint on a move, mark it after typing. */
  settle(input: ResolvedInput, outcome: { previewId?: string; url?: string }, typed: boolean): void
}

export function createTabTaint(): TabTaint {
  /** Tainted tabs, with the URL the secret was typed at (absent when never learned). */
  const tainted = new Map<string, string | undefined>()
  const lastUrl = new Map<string, string>()
  const keyOf = (input: ResolvedInput, previewId?: string) => input.preview_id ?? previewId ?? ''

  return {
    refuses(input) {
      if (!isTaintSensitive(input) || tainted.size === 0) return false
      return !input.preview_id || tainted.has(input.preview_id) || tainted.has('')
    },
    settle(input, outcome, typed) {
      const key = keyOf(input, outcome.previewId)
      const before = lastUrl.get(key)
      const { url } = outcome
      if (url) lastUrl.set(key, url)
      const at = tainted.get(key)
      if (tainted.has(key) && at !== undefined && url && url !== at) tainted.delete(key)
      if (!typed) return
      // Typing, then a move to another address in the same call: the secret is behind us.
      if (before && url && url !== before) return
      tainted.set(key, before ?? url)
    },
  }
}
