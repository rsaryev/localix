import { freezeDeep } from './intercept'

/**
 * `next.trace`, as Claude Code's `next` carries it: what settled beneath a hook on its latest
 * `next()`, an entry per link that ran, nearest first, the engine's own last; frozen data.
 */

export type TraceOutcome =
  | 'caught'
  | 'expired'
  | 'kept'
  | 'passed'
  | 'rejected'
  | 'returned'
  | 'skipped'

export interface TraceEntry {
  readonly index: number
  readonly plugin: string
  readonly tier: 'user' | 'core'
  readonly event: string
  readonly outcome: TraceOutcome
  readonly ms: number
  readonly received: unknown
  readonly returned: unknown
}

/** One link's entry, for the trace of the hook above it. */
export function traceEntry(
  link: { index: number; plugin: string; event: string; startedAt: number },
  outcome: TraceOutcome,
  received: unknown,
  returned: unknown,
): TraceEntry {
  return freezeDeep({
    index: link.index,
    plugin: link.plugin,
    tier: link.plugin === 'engine' ? 'core' : 'user',
    event: link.event,
    outcome,
    ms: Math.max(0, Date.now() - link.startedAt),
    received,
    returned: outcome === 'skipped' || outcome === 'rejected' ? undefined : returned,
  }) as TraceEntry
}
