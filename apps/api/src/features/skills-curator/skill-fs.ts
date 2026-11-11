import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { localixHome } from '../../lib/env'
import { claudeConfigDir } from '../cc-settings/config-dir'
import { readSkillFolder, type FolderSkill } from '../plugins/kit'
import type { SkillScope, SkillUsageRecord } from './repository'

/** A skill the curator tends: a folder of the shelf's skills folder, or of its archive. */
export interface CuratorSkill extends FolderSkill {
  readonly scope: SkillScope
}

/** `~/.localix/skills-archive`: the default home of archived skills. */
export const defaultArchiveRoot = (): string => join(localixHome(), 'skills-archive')

/**
 * The one exact skills folder of a shelf (no fallback): the project's `.claude/skills`, or the
 * person's (`CLAUDE_CONFIG_DIR`, else `<home>/.claude`) where Localix writes their skills.
 */
export function skillBase(
  workingDir: string | null,
  globalBase: string,
): { root: string; scope: SkillScope } {
  return workingDir && workingDir !== globalBase
    ? { root: join(workingDir, '.claude', 'skills'), scope: 'project' }
    : { root: join(claudeConfigDir(globalBase), 'skills'), scope: 'global' }
}

/** A folder's skills, read as the kit reads a skills folder, first-wins by name. */
async function readShelf(root: string, scope: SkillScope): Promise<CuratorSkill[]> {
  const byName = new Map<string, CuratorSkill>()
  for (const skill of await readSkillFolder(root, scope === 'project' ? 'project' : 'user'))
    if (!byName.has(skill.name)) byName.set(skill.name, { ...skill, scope })
  return [...byName.values()]
}

/** Active skills of the shelf's one skills folder. */
export async function scanSkillRoots(
  workingDir: string | null,
  globalBase: string,
): Promise<CuratorSkill[]> {
  const { root, scope } = skillBase(workingDir, globalBase)
  return readShelf(root, scope)
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
): Promise<CuratorSkill[]> {
  const { scope } = skillBase(workingDir, globalBase)
  return readShelf(archiveDirOf(archiveRoot, projectId), scope)
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
  skill: CuratorSkill,
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
  skill: CuratorSkill,
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
