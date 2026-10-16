import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { skillRoot, readSkillsFromRoot, type DiscoveredSkill } from '../agent-core/skill-discovery'
import type { SkillScope, SkillUsageRecord } from './repository'

export const ARCHIVE_DIR_NAME = '.archive'

/** The one exact skill root to scan (project or no-project home; no fallback). */
export function skillBases(
  workingDir: string | null,
  globalBase: string,
): Array<{ base: string; scope: SkillScope }> {
  return workingDir && workingDir !== globalBase
    ? [{ base: workingDir, scope: 'project' }]
    : [{ base: globalBase, scope: 'global' }]
}

/**
 * Scans every skill root, first-wins by name. `extraSeg` lets the caller dive
 * into the sibling `.archive/` folder of each root (vs the active root).
 */
export async function scanSkillRoots(
  workingDir: string | null,
  globalBase: string,
  extraSeg?: string,
): Promise<DiscoveredSkill[]> {
  const byName = new Map<string, DiscoveredSkill>()
  for (const { base, scope } of skillBases(workingDir, globalBase)) {
    const activeRoot = skillRoot(base)
    const root = extraSeg ? join(activeRoot, extraSeg) : activeRoot
    for (const s of await readSkillsFromRoot(root, scope)) {
      if (!byName.has(s.name)) byName.set(s.name, s)
    }
  }
  return [...byName.values()]
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

/** Moves a skill dir into the sibling `.archive/` folder of its skills root. Never deletes. */
export async function moveToArchive(skill: DiscoveredSkill): Promise<string> {
  const archiveRoot = join(dirname(skill.dir), ARCHIVE_DIR_NAME)
  await fs.mkdir(archiveRoot, { recursive: true })
  const target = join(archiveRoot, basename(skill.dir))
  await fs.rm(target, { recursive: true, force: true })
  await fs.rename(skill.dir, target)
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
