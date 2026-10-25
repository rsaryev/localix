import type { DiscoveredSkill } from '../agent-core/skill-discovery'
import type { SkillUsageRecord } from './repository'
import { skillAgeBasis } from './skill-fs'

/** Never used and older than this ⇒ stale. */
export const STALE_AFTER_DAYS = 30
/** Last used longer ago than this ⇒ stale. */
export const UNUSED_AFTER_DAYS = 90
/** Scheduled curator cadence — at most one automatic pass per this interval. */
export const CURATOR_INTERVAL_DAYS = 7

export const DAY_MS = 24 * 60 * 60 * 1000

/** What a skill's idleness says: since when it is idle, and when it counts as stale. */
export interface Idleness {
  /** Its last use, or when it was made when it was never used (ms). */
  idleSince: number
  /** When it becomes stale (ms); in the past when it already is. */
  staleAt: number
  stale: boolean
}

/**
 * THE STALENESS RULE, in one place: a pinned skill is never stale; a used one is stale
 * {@link UNUSED_AFTER_DAYS} after its last use; one never used {@link STALE_AFTER_DAYS} after it
 * was made. The pass, the preview and a skill's page all read this.
 */
export async function idlenessOf(
  skill: DiscoveredSkill,
  usage: SkillUsageRecord | null,
  nowMs: number,
): Promise<Idleness | null> {
  if (usage?.pinned) return null
  const used = usage?.lastUsedAt ? Date.parse(usage.lastUsedAt) : null
  const idleSince = used ?? (await skillAgeBasis(skill, usage, nowMs))
  const staleAt = idleSince + (used === null ? STALE_AFTER_DAYS : UNUSED_AFTER_DAYS) * DAY_MS
  return { idleSince, staleAt, stale: nowMs > staleAt }
}

/**
 * The scheduled pass that archives a skill stale from `staleAt`: the first on or after it, the
 * next one being {@link CURATOR_INTERVAL_DAYS} after the last (`lastRunAt`; a first observation
 * only seeds the marker, so with none the first pass is a full interval from now).
 */
export function archivePassAfter(staleAt: number, nowMs: number, lastRunAt: number | null): number {
  const interval = CURATOR_INTERVAL_DAYS * DAY_MS
  const next = Math.max((lastRunAt ?? nowMs) + interval, nowMs)
  if (staleAt <= next) return next
  return next + Math.ceil((staleAt - next) / interval) * interval
}
