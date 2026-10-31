import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { errorMessage } from '../../lib/errors'
import { homedir } from 'node:os'
import { localixHome } from '../../lib/env'
import { basename, join } from 'node:path'
import { skillRoot } from '../agent-core/skill-discovery'
import type { CuratorSkillRecord } from './contracts'
import { toRecord, withSkillDir, type InventoryEntry } from './inventory-record'
import {
  defaultArchiveRoot,
  moveDir,
  moveToArchive,
  readCuratorMarker,
  skillBase,
  scanArchivedSkills,
  scanSkillRoots,
  writeCuratorMarker,
} from './skill-fs'
import { CURATOR_INTERVAL_DAYS, DAY_MS, archivePassAfter, idlenessOf } from './staleness'

export { CURATOR_INTERVAL_DAYS } from './staleness'
export type { SkillsCuratorService, SkillsCuratorServiceDeps } from './service-types'
import type { SkillsCuratorService, SkillsCuratorServiceDeps } from './service-types'

export function createSkillsCuratorService(deps: SkillsCuratorServiceDeps): SkillsCuratorService {
  const globalBase = deps.globalBase ?? homedir()
  const archiveRoot = deps.archiveRoot ?? defaultArchiveRoot()
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
  /** Scans the archive folder of the same shelf. */
  const scanArchived = (workingDir: string | null, projectId: string) =>
    scanArchivedSkills(workingDir, globalBase, archiveRoot, projectId)

  const lastPassAt = async (): Promise<number | null> => {
    const marker = await readCuratorMarker(stateFile)
    return marker ? Date.parse(marker.lastRunAt) : null
  }

  async function inventory(
    userId: string,
    workingDir: string | null,
    projectId = '',
  ): Promise<InventoryEntry[]> {
    const [active, archived, usageRows] = await Promise.all([
      scanActive(workingDir),
      scanArchived(workingDir, projectId),
      deps.usageRepo.list(userId, projectId),
    ])
    const usageByKey = new Map(usageRows.map((u) => [`${u.scope}:${u.skillName}`, u]))
    const nowMs = now().getTime()
    // The scheduled pass only ever covers the person's own skills; a project's wait for the
    // shelf's "Archive unused".
    const lastRunAt = workingDir ? null : await lastPassAt()
    // idlenessOf() may fs.stat() per never-used skill; the checks are independent,
    // so resolve them in parallel rather than one fs.stat at a time.
    const entries: InventoryEntry[] = await Promise.all(
      active.map(async (skill): Promise<InventoryEntry> => {
        const usage = usageByKey.get(`${skill.scope}:${skill.name}`) ?? null
        // `.claude/skills` is shared with Claude Code, whose use Localix cannot see: only a skill
        // made in Localix ages out. The others stay active, with no "will be archived" notice;
        // they can still be archived by hand.
        if (usage?.localixAuthored !== true)
          return { skill, usage, archived: false, state: 'active' }
        const idle = await idlenessOf(skill, usage, nowMs)
        const state = idle?.stale ? 'stale' : 'active'
        if (!idle) return { skill, usage, archived: false, state }
        const archiveOn = workingDir ? null : archivePassAfter(idle.staleAt, nowMs, lastRunAt)
        return { skill, usage, archived: false, state, idle: { ...idle, archiveOn } }
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

  async function archiveEntry(
    userId: string,
    entry: InventoryEntry,
    archivedAt: string,
    projectId: string,
  ): Promise<CuratorSkillRecord> {
    const dir = await moveToArchive(entry.skill, archiveRoot, projectId)
    // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- persist archived state only after the filesystem move succeeds; otherwise inventory would claim a phantom archive
    const usage = await deps.usageRepo.setArchivedAt(
      userId,
      projectId,
      entry.skill.name,
      entry.skill.scope,
      archivedAt,
    )
    // A skill's files moved: the capability set changed (the relay pokes clients on the bump).
    deps.capabilitiesChanged?.()
    return toRecord({
      skill: withSkillDir(entry.skill, dir),
      usage,
      archived: true,
      state: 'archived',
    })
  }

  /** Archive each entry, one failing not stopping the rest. */
  async function archiveEntries(
    userId: string,
    entries: InventoryEntry[],
    projectId: string,
  ): Promise<CuratorSkillRecord[]> {
    const archivedAt = now().toISOString()
    const done: CuratorSkillRecord[] = []
    for (const entry of entries) {
      try {
        done.push(await archiveEntry(userId, entry, archivedAt, projectId))
      } catch (e) {
        deps.logger?.warn?.(`curator: failed to archive "${entry.skill.name}": ${errorMessage(e)}`)
      }
    }
    return done
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
      deps.capabilitiesChanged?.()
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
      if (!entry) throw new NotFoundError('skill_not_found', `Skill not found: "${input.name}"`)
      if (entry.archived)
        throw new ConflictError('skill_archived', `Skill "${input.name}" is already archived`)
      return archiveEntry(userId, entry, now().toISOString(), projectId)
    },

    async restore(userId, input) {
      const workingDir = await workingDirFor(userId, input.projectId)
      const projectId = input.projectId ?? ''
      const entries = await inventory(userId, workingDir, projectId)
      const entry = entries.find((e) => e.skill.name === input.name && e.archived)
      if (!entry)
        throw new NotFoundError('skill_not_found', `Archived skill not found: "${input.name}"`)
      if (entries.some((e) => e.skill.name === input.name && !e.archived)) {
        throw new ConflictError(
          'skill_exists',
          `An active skill named "${input.name}" already exists`,
        )
      }
      const { base } = skillBase(workingDir, globalBase)
      const target = join(skillRoot(base), basename(entry.skill.dir))
      if (
        await fs.stat(target).then(
          () => true,
          () => false,
        )
      )
        throw new ConflictError(
          'skill_exists',
          `A folder named "${basename(target)}" already exists`,
        )
      await moveDir(entry.skill.dir, target)
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
      deps.capabilitiesChanged?.()
      return toRecord({
        skill: withSkillDir(entry.skill, target),
        usage,
        archived: false,
        state: 'active',
      })
    },

    async archiveUnused(userId, input) {
      const workingDir = await workingDirFor(userId, input.projectId)
      const projectId = input.projectId ?? ''
      const chosen = new Set(input.names)
      const entries = await inventory(userId, workingDir, projectId)
      const archived = await archiveEntries(
        userId,
        entries.filter((e) => e.state === 'stale' && chosen.has(e.skill.name)),
        projectId,
      )
      return archived
    },

    async runCurator(userId, opts) {
      const workingDir = await workingDirFor(userId, opts?.projectId)
      const projectId = opts?.projectId ?? ''
      const entries = await inventory(userId, workingDir, projectId)
      const staleEntries = entries.filter((e) => e.state === 'stale')
      const archivedNow = (await archiveEntries(userId, staleEntries, projectId)).map((r) => r.name)
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
      if (report.archivedNow.length > 0) deps.onArchived?.(userId, report.archivedNow)
      return report
    },
  }
}
