import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { errorMessage } from '../../lib/errors'
import { skillRoot } from '../agent-core/skill-discovery'
import type { SkillScope, SkillUsageRepository } from './repository'
import { archiveDirOf, moveDir } from './skill-fs'

/**
 * ONE-TIME MOVE of the skills Localix used to keep in `<base>/.localix/skills` into Claude Code's
 * own folders, `<base>/.claude/skills` (the home, and every known project). This is the only code
 * that knows the old path; discovery, the Store and the curator read `.claude/skills` alone.
 *
 * - A skill folder moves whole. On a name that `.claude/skills` already holds, the `.claude` one
 *   wins and the old one is dropped, and the drop is logged.
 * - Skills the curator had archived (`.localix/skills/.archive/<name>`) move to the archive folder
 *   outside `.claude/skills` (`archiveDirOf`), under the same rule.
 * - Every moved skill is recorded as created in Localix, so the idle rule keeps applying to it.
 *   Usage rows are keyed by (scope, project, name), which a move does not change.
 * - Afterwards the old `.localix/skills` folder is removed, and a marker file records the run.
 *   A failure leaves the marker unwritten, so the next start finishes what is left.
 */

const OLD_ROOT = ['.localix', 'skills'] as const
const OLD_ARCHIVE = '.archive'

export interface LegacySkillsLogger {
  info: (fields: object, msg?: string) => void
  warn: (fields: object, msg?: string) => void
}

export interface LegacySkillsMigrationInput {
  userId: string
  homeDir: string
  /** Where archived skills wait (`~/.localix/skills-archive`). */
  archiveRoot: string
  /** Written when the migration finished; its presence skips the run. */
  markerFile: string
  /** The known projects: id and working directory. */
  projects: () => Promise<Array<{ id: string; workingDir: string }>>
  usage: Pick<SkillUsageRepository, 'markAuthored'>
  logger: LegacySkillsLogger
}

export interface LegacySkillsReport {
  moved: string[]
  archived: string[]
  dropped: string[]
  failed: string[]
}

const exists = (path: string) =>
  fs.lstat(path).then(
    () => true,
    () => false,
  )

async function skillFolders(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const names: string[] = []
  for (const entry of entries) {
    if (entry.name === OLD_ARCHIVE) continue
    const isDir =
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        (await fs.stat(join(dir, entry.name)).then(
          (s) => s.isDirectory(),
          () => false,
        )))
    if (isDir) names.push(entry.name)
  }
  return names
}

async function modifiedAt(skillDir: string): Promise<string | undefined> {
  try {
    return (await fs.stat(join(skillDir, 'SKILL.md'))).mtime.toISOString()
  } catch {
    return undefined
  }
}

export async function migrateLegacySkills(
  input: LegacySkillsMigrationInput,
): Promise<LegacySkillsReport | null> {
  if (await exists(input.markerFile)) return null
  const report: LegacySkillsReport = { moved: [], archived: [], dropped: [], failed: [] }
  const { logger } = input

  // One entry per directory: two projects may share a folder, the files move once.
  const places = new Map<string, Array<{ projectId: string; scope: SkillScope }>>()
  const add = (dir: string, projectId: string, scope: SkillScope) => {
    const key = resolve(dir)
    places.set(key, [...(places.get(key) ?? []), { projectId, scope }])
  }
  add(input.homeDir, '', 'global')
  for (const p of await input.projects()) add(p.workingDir, p.id, 'project')

  for (const [base, owners] of places) {
    const old = join(base, ...OLD_ROOT)
    if (!(await exists(old))) continue
    const mark = async (name: string, from: string, owner: (typeof owners)[number]) => {
      await input.usage.markAuthored(
        input.userId,
        owner.projectId,
        name,
        owner.scope,
        await modifiedAt(from),
      )
    }
    const settle = async (from: string, to: string, label: string, list: string[]) => {
      if (await exists(to)) {
        await fs.rm(from, { recursive: true, force: true })
        report.dropped.push(from)
        logger.warn(
          { event: 'skills.migrate.dropped', from, kept: to },
          `${label} "${from}" was dropped: "${to}" already exists and wins`,
        )
        return false
      }
      await moveDir(from, to)
      list.push(to)
      return true
    }
    try {
      for (const name of await skillFolders(old)) {
        const from = join(old, name)
        const modified = await modifiedAt(from)
        if (await settle(from, join(skillRoot(base), name), 'Skill', report.moved)) {
          for (const owner of owners) {
            await input.usage.markAuthored(
              input.userId,
              owner.projectId,
              name,
              owner.scope,
              modified,
            )
          }
        }
      }
      // An archive is per shelf, so a folder shared by two projects archives under the first.
      const [first] = owners
      const archiveFrom = join(old, OLD_ARCHIVE)
      for (const name of await skillFolders(archiveFrom)) {
        const from = join(archiveFrom, name)
        const to = join(archiveDirOf(input.archiveRoot, first!.projectId), name)
        if (await settle(from, to, 'Archived skill', report.archived)) await mark(name, to, first!)
      }
      await fs.rm(old, { recursive: true, force: true })
    } catch (error) {
      report.failed.push(old)
      logger.warn(
        { event: 'skills.migrate.failed', path: old, error: errorMessage(error) },
        'Moving skills to .claude/skills failed; it is tried again at the next start',
      )
    }
  }

  logger.info(
    { event: 'skills.migrate.done', ...report },
    `Skills moved to .claude/skills: ${report.moved.length} moved, ${report.archived.length} archived, ${report.dropped.length} dropped`,
  )
  if (report.failed.length === 0) {
    await fs.mkdir(resolve(input.markerFile, '..'), { recursive: true })
    await fs.writeFile(
      input.markerFile,
      JSON.stringify({ version: 1, at: new Date().toISOString(), ...report }, null, 2) + '\n',
    )
  }
  return report
}
