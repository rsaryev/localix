import type { DiscoveredSkill } from '../agent-core/skill-discovery'
import type { SkillUsageRecord } from './repository'
import type { Idleness } from './staleness'
import type { CuratorSkillRecord, SkillLifecycleState } from './contracts'

export interface InventoryEntry {
  skill: DiscoveredSkill
  usage: SkillUsageRecord | null
  archived: boolean
  state: SkillLifecycleState
  /** Absent for a pinned or archived skill. */
  idle?: Idleness & { archiveOn: number | null }
}

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString())

export function toRecord(entry: InventoryEntry): CuratorSkillRecord {
  return {
    name: entry.skill.name,
    description: entry.skill.description,
    scope: entry.skill.scope,
    dir: entry.skill.dir,
    getCount: entry.usage?.getCount ?? 0,
    lastUsedAt: entry.usage?.lastUsedAt ?? null,
    pinned: entry.usage?.pinned ?? false,
    archivedAt: entry.usage?.archivedAt ?? null,
    state: entry.state,
    idleSince: iso(entry.idle?.idleSince),
    staleAt: iso(entry.idle?.staleAt),
    archiveOn: iso(entry.idle?.archiveOn),
  }
}

/**
 * Repoint an inventory snapshot without evaluating its lazy `content` getter.
 * Moving the directory first makes that getter's original path stale, while a
 * spread would eagerly read it and turn a successful archive/restore into ENOENT.
 * Curator records never expose the body; a later inventory scan creates a fresh
 * lazy getter rooted at the new path.
 */
export function withSkillDir(skill: DiscoveredSkill, dir: string): DiscoveredSkill {
  const { content: _content, dir: _dir, ...metadata } = Object.getOwnPropertyDescriptors(skill)
  return Object.defineProperties({ content: '', dir }, metadata) as DiscoveredSkill
}
