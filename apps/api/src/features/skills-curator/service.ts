import { promises as fs } from 'node:fs'
import { errorMessage } from '../../lib/errors'
import { homedir } from 'node:os'
import { localixHome } from '../../lib/env'
import { basename, dirname, join } from 'node:path'
import { ApiError } from '../../lib/errors'
import type { DiscoveredSkill } from '../agent-core/skill-discovery'
import type { SkillUsageRepository, SkillScope, SkillUsageRecord } from './repository'
import type { CuratorReport, CuratorSkillRecord, SkillLifecycleState } from './contracts'
import {
  ARCHIVE_DIR_NAME,
  moveToArchive,
  readCuratorMarker,
  scanSkillRoots,
  skillAgeBasis,
  writeCuratorMarker,
} from './skill-fs'

// Re-export so the historical './service' import surface (curator tests) stays stable.
export { ARCHIVE_DIR_NAME } from './skill-fs'

/** Never used and older than this ⇒ stale. */
export const STALE_AFTER_DAYS = 30
/** Last used longer ago than this ⇒ stale. */
export const UNUSED_AFTER_DAYS = 90
/** Scheduled curator cadence — at most one automatic pass per this interval. */
export const CURATOR_INTERVAL_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export interface SkillsCuratorServiceDeps {
  usageRepo: SkillUsageRepository
  /** Resolves a project's working dir for project-scoped skills (REST passes projectId). */
  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  /** Base dir for global skills (`<globalBase>/.localix/skills`). Defaults to the home dir. */
  globalBase?: string
  /** Marker file for the scheduled-run cadence. Defaults to `~/.localix/curator-state.json`. */
  stateFile?: string
  now?: () => Date
  logger?: { info?: (msg: string) => void; warn?: (msg: string) => void }
}

export interface SkillsCuratorService {
  listSkills(userId: string, opts?: { projectId?: string | null }): Promise<CuratorSkillRecord[]>
  setPinned(
    userId: string,
    input: {
      name: string
      scope: SkillScope
      pinned: boolean
      projectId?: string | null
    },
  ): Promise<CuratorSkillRecord>
  archive(
    userId: string,
    input: { name: string; projectId?: string | null },
  ): Promise<CuratorSkillRecord>
  restore(
    userId: string,
    input: { name: string; projectId?: string | null },
  ): Promise<CuratorSkillRecord>
  /** One deterministic pass: archive stale, unpinned filesystem skills. */
  runCurator(userId: string, opts?: { projectId?: string | null }): Promise<CuratorReport>
  /**
   * Cadence-guarded scheduled entry point (startup + periodic timer). First
   * observation only seeds the marker (first-run defer); later
   * calls run a global pass at most once per {@link CURATOR_INTERVAL_DAYS}.
   * Returns the report when a pass actually ran, null otherwise.
   */
  maybeRunScheduled(userId: string): Promise<CuratorReport | null>
}

interface InventoryEntry {
  skill: DiscoveredSkill
  usage: SkillUsageRecord | null
  archived: boolean
  state: SkillLifecycleState
}

export function createSkillsCuratorService(deps: SkillsCuratorServiceDeps): SkillsCuratorService {
  const globalBase = deps.globalBase ?? homedir()
  const stateFile = deps.stateFile ?? join(localixHome(), 'curator-state.json')
  const now = deps.now ?? (() => new Date())

  const workingDirFor = async (
    userId: string,
    projectId?: string | null,
  ): Promise<string | null> => {
    if (!projectId || !deps.resolveProjectCwd) return null
    return deps.resolveProjectCwd(userId, projectId)
  }

  /** Scans active skill roots. */
  const scanActive = (workingDir: string | null) => scanSkillRoots(workingDir, globalBase)
  /** Scans `.archive/` folders inside the same skill roots. */
  const scanArchived = (workingDir: string | null) =>
    scanSkillRoots(workingDir, globalBase, ARCHIVE_DIR_NAME)

  async function isStale(skill: DiscoveredSkill, usage: SkillUsageRecord | null): Promise<boolean> {
    const nowMs = now().getTime()
    if (usage?.pinned) return false
    if (usage?.lastUsedAt) {
      return nowMs - Date.parse(usage.lastUsedAt) > UNUSED_AFTER_DAYS * DAY_MS
    }
    // Never used: stale once older than STALE_AFTER_DAYS.
    const createdMs = await skillAgeBasis(skill, usage, nowMs)
    return nowMs - createdMs > STALE_AFTER_DAYS * DAY_MS
  }

  async function inventory(
    userId: string,
    workingDir: string | null,
    projectId = '',
  ): Promise<InventoryEntry[]> {
    const [active, archived, usageRows] = await Promise.all([
      scanActive(workingDir),
      scanArchived(workingDir),
      deps.usageRepo.list(userId, projectId),
    ])
    const usageByKey = new Map(usageRows.map((u) => [`${u.scope}:${u.skillName}`, u]))
    // isStale() may fs.stat() per never-used skill; the checks are independent,
    // so resolve them in parallel rather than one fs.stat at a time.
    const entries: InventoryEntry[] = await Promise.all(
      active.map(async (skill): Promise<InventoryEntry> => {
        const usage = usageByKey.get(`${skill.scope}:${skill.name}`) ?? null
        const stale = await isStale(skill, usage)
        return { skill, usage, archived: false, state: stale ? 'stale' : 'active' }
      }),
    )
    const activeNames = new Set(active.map((s) => s.name))
    for (const skill of archived) {
      if (activeNames.has(skill.name)) continue
      const usage = usageByKey.get(`${skill.scope}:${skill.name}`) ?? null
      entries.push({ skill, usage, archived: true, state: 'archived' })
    }
    return entries.sort((a, b) => a.skill.name.localeCompare(b.skill.name))
  }

  function toRecord(entry: InventoryEntry): CuratorSkillRecord {
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
    }
  }

  /**
   * Repoint an inventory snapshot without evaluating its lazy `content` getter.
   * Moving the directory first makes that getter's original path stale, while a
   * spread would eagerly read it and turn a successful archive/restore into ENOENT.
   * Curator records never expose the body; a later inventory scan creates a fresh
   * lazy getter rooted at the new path.
   */
  function withSkillDir(skill: DiscoveredSkill, dir: string): DiscoveredSkill {
    const { content: _content, dir: _dir, ...metadata } = Object.getOwnPropertyDescriptors(skill)
    return Object.defineProperties({ content: '', dir }, metadata) as DiscoveredSkill
  }

  async function archiveEntry(
    userId: string,
    entry: InventoryEntry,
    archivedAt: string,
    projectId: string,
  ): Promise<CuratorSkillRecord> {
    const dir = await moveToArchive(entry.skill)
    // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- persist archived state only after the filesystem move succeeds; otherwise inventory would claim a phantom archive
    const usage = await deps.usageRepo.setArchivedAt(
      userId,
      projectId,
      entry.skill.name,
      entry.skill.scope,
      archivedAt,
    )
    return toRecord({
      skill: withSkillDir(entry.skill, dir),
      usage,
      archived: true,
      state: 'archived',
    })
  }

  return {
    async listSkills(userId, opts) {
      const workingDir = await workingDirFor(userId, opts?.projectId)
      return (await inventory(userId, workingDir, opts?.projectId ?? '')).map(toRecord)
    },

    async setPinned(userId, input) {
      const projectId = input.scope === 'project' ? (input.projectId ?? '') : ''
      // Persisting the pin and resolving the project root share no dependency.
      // Start both before inventory: project lookup may cross the repository/API
      // boundary, and serial latency here makes the settings toggle feel sticky.
      const [usage, workingDir] = await Promise.all([
        deps.usageRepo.setPinned(userId, projectId, input.name, input.scope, input.pinned),
        workingDirFor(userId, projectId),
      ])
      // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- inventory derives stale/active state from the newly persisted pin and must observe it
      const entries = await inventory(userId, workingDir, projectId)
      const entry = entries.find((e) => e.skill.name === input.name)
      if (entry) return toRecord({ ...entry, usage })
      return {
        name: input.name,
        description: '',
        scope: input.scope,
        dir: '',
        getCount: usage.getCount,
        lastUsedAt: usage.lastUsedAt,
        pinned: usage.pinned,
        archivedAt: usage.archivedAt,
        state: usage.archivedAt ? 'archived' : 'active',
      }
    },

    async archive(userId, input) {
      const workingDir = await workingDirFor(userId, input.projectId)
      const projectId = input.projectId ?? ''
      const entries = await inventory(userId, workingDir, projectId)
      const entry = entries.find((e) => e.skill.name === input.name)
      if (!entry) throw new ApiError(404, 'skill_not_found', `Skill not found: "${input.name}"`)
      if (entry.archived)
        throw new ApiError(409, 'skill_archived', `Skill "${input.name}" is already archived`)
      return archiveEntry(userId, entry, now().toISOString(), projectId)
    },

    async restore(userId, input) {
      const workingDir = await workingDirFor(userId, input.projectId)
      const projectId = input.projectId ?? ''
      const entries = await inventory(userId, workingDir, projectId)
      const entry = entries.find((e) => e.skill.name === input.name && e.archived)
      if (!entry)
        throw new ApiError(404, 'skill_not_found', `Archived skill not found: "${input.name}"`)
      if (entries.some((e) => e.skill.name === input.name && !e.archived)) {
        throw new ApiError(
          409,
          'skill_exists',
          `An active skill named "${input.name}" already exists`,
        )
      }
      const activeRoot = dirname(dirname(entry.skill.dir)) // …/skills/.archive/<name> → …/skills
      const target = join(activeRoot, basename(entry.skill.dir))
      await fs.rename(entry.skill.dir, target)
      // Reset usage so the skill isn't immediately re-archived on the next pass.
      await deps.usageRepo.recordUse(
        userId,
        projectId,
        entry.skill.name,
        entry.skill.scope,
        now().toISOString(),
      )
      const usage = await deps.usageRepo.setArchivedAt(
        userId,
        projectId,
        entry.skill.name,
        entry.skill.scope,
        null,
      )
      return toRecord({
        skill: withSkillDir(entry.skill, target),
        usage,
        archived: false,
        state: 'active',
      })
    },

    async runCurator(userId, opts) {
      const workingDir = await workingDirFor(userId, opts?.projectId)
      const projectId = opts?.projectId ?? ''
      const entries = await inventory(userId, workingDir, projectId)
      const archivedAt = now().toISOString()
      const staleEntries = entries.filter((e) => e.state === 'stale')
      const archivedNow: string[] = []
      for (const entry of staleEntries) {
        try {
          await archiveEntry(userId, entry, archivedAt, projectId)
          archivedNow.push(entry.skill.name)
        } catch (e) {
          deps.logger?.warn?.(
            `curator: failed to archive "${entry.skill.name}": ${errorMessage(e)}`,
          )
        }
      }
      const alreadyArchived = entries.filter((e) => e.archived).length
      return {
        active: entries.length - alreadyArchived - archivedNow.length,
        stale: staleEntries.length,
        archived: alreadyArchived + archivedNow.length,
        archivedNow,
      }
    },

    async maybeRunScheduled(userId) {
      const marker = await readCuratorMarker(stateFile)
      const nowIso = now().toISOString()
      if (!marker) {
        // First observation: seed the marker and defer one full interval, so the
        // user gets a chance to pin skills before the curator ever touches them.
        await writeCuratorMarker(stateFile, nowIso)
        return null
      }
      const elapsed = now().getTime() - Date.parse(marker.lastRunAt)
      if (!(elapsed >= CURATOR_INTERVAL_DAYS * DAY_MS)) return null
      const report = await this.runCurator(userId)
      await writeCuratorMarker(stateFile, nowIso)
      deps.logger?.info?.(`curator: scheduled pass archived ${report.archivedNow.length} skill(s)`)
      return report
    },
  }
}
