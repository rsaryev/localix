/**
 * How long a `wait` step may hold a command. The probe enforces the limit; the hosts that relay
 * the command (the preview iframe, a native WebView) must keep their own answer window open that
 * long, or they give up on a command that is still legitimately running.
 */
import type { VfCommand } from './index'

export const DEFAULT_WAIT_MS = 10_000
export const MAX_WAIT_MS = 15_000

/** One wait's limit: the requested ms, defaulted and kept between 0 and the cap. */
export function waitLimitMs(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return DEFAULT_WAIT_MS
  return Math.min(Math.max(Math.round(requested), 0), MAX_WAIT_MS)
}

/** The time a command may spend waiting in the page: its `wait` steps' limits, summed. */
export function commandWaitMs(command: Pick<VfCommand, 'steps'>): number {
  return (command.steps ?? []).reduce(
    (sum, step) => (step.action === 'wait' ? sum + waitLimitMs(step.timeoutMs) : sum),
    0,
  )
}
