/**
 * The `wait` step's tool-side rules: how long it may run, and how long the relay must stay open
 * for it. The page polls (packages/visual-feedback `wait.ts`); this file only keeps the two
 * ends of the relay from giving up before the page does.
 */
import type { BrowserInput } from './browser-input'

/** The longest a single wait may run, and the default; the page enforces both too. */
export const DEFAULT_WAIT_MS = 10_000
export const MAX_WAIT_MS = 15_000

/**
 * The relay's usual window (the preview command registry's default, which agent-core cannot
 * import). A wait is time the command legitimately spends in the page, so it is added to the
 * window instead of racing it.
 */
const RELAY_WINDOW_MS = 22_000

/** One wait's limit as the page will apply it. */
export function waitLimitMs(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return DEFAULT_WAIT_MS
  return Math.min(Math.max(Math.round(requested), 0), MAX_WAIT_MS)
}

/** The relay timeout for a call, or undefined (the registry's default) when nothing waits. */
export function relayTimeoutMs(
  input: Pick<BrowserInput, 'steps'> & { action?: unknown },
): number | undefined {
  const waits = (input.steps ?? []).filter((step) => step.action === 'wait')
  if (!waits.length) return undefined
  return RELAY_WINDOW_MS + waits.reduce((sum, step) => sum + waitLimitMs(step.timeout_ms), 0)
}
