import { basename, join } from 'node:path'
import type { CuratorSkill } from './skill-fs'
import type { SkillUsageRecord } from './repository'
import type { Idleness } from './staleness'
import type { CuratorSkillRecord, SkillLifecycleState } from './contracts'

export interface InventoryEntry {
  skill: CuratorSkill
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

/** The skill moved to `dir` (archived, restored); a later scan reads it there afresh. */
export function withSkillDir(skill: CuratorSkill, dir: string): CuratorSkill {
  return { ...skill, dir, path: join(dir, basename(skill.path)) }
}
