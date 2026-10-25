import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { localixHome } from '../../lib/env'
import { skillRoot, readSkillsFromRoot, type DiscoveredSkill } from '../agent-core/skill-discovery'
import type { SkillScope, SkillUsageRecord } from './repository'

/** `~/.localix/skills-archive`: the default home of archived skills. */
export const defaultArchiveRoot = (): string => join(localixHome(), 'skills-archive')

/** The one exact skill root to scan (project or no-project home; no fallback). */
export function skillBases(
  workingDir: string | null,
  globalBase: string,
): Array<{ base: string; scope: SkillScope }> {
  return workingDir && workingDir !== globalBase
    ? [{ base: workingDir, scope: 'project' }]
    : [{ base: globalBase, scope: 'global' }]
}

/** Active skills of the one exact root (`.claude/skills`), first-wins by name. */
export async function scanSkillRoots(
  workingDir: string | null,
  globalBase: string,
): Promise<DiscoveredSkill[]> {
  const byName = new Map<string, DiscoveredSkill>()
  for (const { base, scope } of skillBases(workingDir, globalBase)) {
    for (const s of await readSkillsFromRoot(skillRoot(base), scope)) {
      if (!byName.has(s.name)) byName.set(s.name, s)
    }
  }
  return [...byName.values()]
}

/**
 * Where archived skills wait: OUTSIDE `.claude/skills`, which Claude Code reads and watches and
 * whose handling of nested folders is not documented, so an archived skill there could load.
 * `<archiveRoot>/<user | projectId>/<name>`.
 */
export function archiveDirOf(archiveRoot: string, projectId: string): string {
  return join(archiveRoot, projectId || 'user')
}

/** The archived skills of one shelf. */
export async function scanArchivedSkills(
  workingDir: string | null,
  globalBase: string,
  archiveRoot: string,
  projectId: string,
): Promise<DiscoveredSkill[]> {
  const [{ scope }] = skillBases(workingDir, globalBase)
  return readSkillsFromRoot(archiveDirOf(archiveRoot, projectId), scope!)
}

/** Renames a folder, copying then removing it when the two places are on different volumes. */
export async function moveDir(from: string, to: string): Promise<void> {
  await fs.mkdir(dirname(to), { recursive: true })
  try {
    await fs.rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await fs.rm(from, { recursive: true, force: true })
  }
}

/** Age basis for staleness: first recorded use, else file mtime, else now. */
export async function skillAgeBasis(
  skill: DiscoveredSkill,
  usage: SkillUsageRecord | null,
  nowMs: number,
): Promise<number> {
  if (usage) return Date.parse(usage.createdAt)
  try {
    const stat = await fs.stat(skill.path)
    return stat.mtimeMs
  } catch {
    return nowMs
  }
}

/** Moves a skill dir into the archive folder of its shelf. Never deletes the skill. */
export async function moveToArchive(
  skill: DiscoveredSkill,
  archiveRoot: string,
  projectId: string,
): Promise<string> {
  const target = join(archiveDirOf(archiveRoot, projectId), basename(skill.dir))
  await fs.rm(target, { recursive: true, force: true })
  await moveDir(skill.dir, target)
  return target
}

/** Marker file backing the scheduled-curator cadence guard. */
export interface CuratorMarker {
  lastRunAt: string
}

export async function readCuratorMarker(stateFile: string): Promise<CuratorMarker | null> {
  try {
    const raw = await fs.readFile(stateFile, 'utf8')
    const parsed = JSON.parse(raw) as { lastRunAt?: unknown }
    return typeof parsed.lastRunAt === 'string' ? { lastRunAt: parsed.lastRunAt } : null
  } catch {
    return null
  }
}

export async function writeCuratorMarker(stateFile: string, lastRunAt: string): Promise<void> {
  await fs.mkdir(dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify({ lastRunAt }, null, 2) + '\n', 'utf8')
}
