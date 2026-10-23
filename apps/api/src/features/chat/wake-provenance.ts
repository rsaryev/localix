/**
 * AUTONOMOUS-WAKE PROVENANCE — the one owner of "which visible turn does a hidden wake
 * row explain?", a leaf subpath (`@localixai/api/wake-provenance`) both transcripts derive
 * from, exactly like the sibling leaves (`item-format`, `slash-catalog`, `context-refs`).
 *
 * The rule: a wake turn (loop / board / sleep / bg-job / bg-monitor / hook /
 * external / mini app / sub-agent) is persisted as a HIDDEN (`isInternal`) user message carrying
 * the `WakeSource`, immediately followed by the visible assistant response. The hidden row never
 * renders, so its source is LIFTED onto the id of the next visible ASSISTANT message — that
 * is what lets a transcript say "via loop" and explain why the agent acted with nobody typing.
 *
 * Two edges the rule turns on, and both were learned the hard way:
 *   - `user-busy` is a genuine QUEUED USER message — it renders as a normal bubble, so it is
 *     not provenance for anything that follows it.
 *   - only the ASSISTANT consumes a pending tag. A system notice or a `uiOnly` divider landing
 *     between the hidden wake row and the assistant turn must NOT swallow it: those render
 *     branches take no wake source, so the tag would simply be lost and the turn would read
 *     as unprompted.
 *
 * WHY THIS FILE EXISTS. The rule was implemented twice — once per client — and the two
 * DRIFTED: the assistant-only consume rule was fixed in one copy and not in the web's, which
 * silently dropped the web's "via Loop" chip. Both copies then grew a comment BEGGING for this module ("give the rule a single
 * owner in a shared `@localixai/api` leaf"). A comment doing an API's job is the tell that the
 * API is missing.
 *
 * Pure + dependency-free at runtime (the only import is the erased `WakeSource` type). The ICON
 * per source stays client-side: an icon is a rendering choice a surface makes for itself (a
 * lucide component on the web), so it is genuinely a per-client fact — the LABEL is one.
 */

import type { WakeSource } from './contracts'

/**
 * The MINIMUM a message must expose to be placed by the lift. Structural, so a client's own
 * message row satisfies it as-is — the leaf never learns any client's full message shape.
 */
export interface WakeRow {
  id: string
  role: 'user' | 'assistant' | 'system'
  /** Hidden from the transcript. Absent ⇒ visible. */
  isInternal?: boolean
  /** Why this turn happened, when it did not happen because the user typed. */
  wakeSource?: string
}

/**
 * Display name per source — the canonical, TITLE-CASE form. A surface wanting the compact
 * lowercase tag (a dim "via loop" line) lowercases it; the reverse is impossible,
 * so the cased form is the one worth owning.
 */
export const WAKE_SOURCE_LABEL: Record<WakeSource, string> = {
  loop: 'Loop',
  'bg-job': 'Job',
  'bg-monitor': 'Monitor',
  'user-busy': 'You',
  'user-steer': 'Mid-run',
  hook: 'Hook',
  external: 'External',
  'mini-app': 'Mini app',
  subagent: 'Sub-agent',
  reaction: 'Reaction',
  delegator: 'Delegator',
  'plan-review': 'Plan review',
  'plan-approved': 'Plan approval',
  resume: 'Continue',
}

const WAKE_SOURCES = new Set<string>(Object.keys(WAKE_SOURCE_LABEL))

/** Runtime guard for schemaless persisted origins and mixed-version clients. */
export function isWakeSource(source: unknown): source is WakeSource {
  return typeof source === 'string' && WAKE_SOURCES.has(source)
}

/**
 * Safe display lookup: unknown and retired origins (a `plugin` wake from before the rename) stay
 * inert instead of crashing a surface.
 */
export function wakeSourceLabel(source: unknown): string | undefined {
  return isWakeSource(source) ? WAKE_SOURCE_LABEL[source] : undefined
}

/**
 * Maps each VISIBLE message id to the wake source that explains it, per the rule in the
 * header. Messages must be in transcript order.
 *
 * A pending tag survives across further hidden rows (only a visible ASSISTANT consumes it),
 * and a STEERED user message is visible with its own provenance — it is badged in place, so
 * the reader knows it was injected into the run above rather than typed after it.
 */
export function deriveWakeProvenance(messages: readonly WakeRow[]): Map<string, WakeSource> {
  const map = new Map<string, WakeSource>()
  let pending: WakeSource | undefined
  for (const m of messages) {
    if (m.isInternal) {
      if (m.role === 'user' && isWakeSource(m.wakeSource) && m.wakeSource !== 'user-busy')
        pending = m.wakeSource
      continue // hidden rows don't consume the pending tag
    }
    if (m.role === 'user' && m.wakeSource === 'user-steer') {
      map.set(m.id, m.wakeSource)
      continue
    }
    if (pending && m.role === 'assistant') {
      map.set(m.id, pending)
      pending = undefined
    }
  }
  return map
}
