import { basename, join } from 'node:path'
import { readSkill, resolveSkillName, type PluginIssue } from '@rsaryev/llx-plugin/format'
import { scanSkillContainer } from '@rsaryev/llx-plugin/skills'
import { diskFolderScan } from './ports/folder-scan'

/**
 * The `SKILL.md` format as the kit reads it, for the code that writes skills outside a run (the
 * Skills list, the `Skill` tool's `save`, the curator's archive): what a skill of a scope is called,
 * where a new one goes and what is wrong with a file. The writes are Localix's
 * (`chat/skill-files.ts`); these say what Claude Code would make of them.
 */

/** The folder kinds Localix writes skills to: the person's `.claude` and a project's. */
export type SkillFolderKind = 'user' | 'project'

/**
 * Where a new skill named `name` of a `.claude` folder lives (skills.md, "Where skills live":
 * `~/.claude/skills/<skill-name>/SKILL.md`, `.claude/skills/<skill-name>/SKILL.md`). The kit keeps
 * the same rule as `SCOPE_RULES` (`skills/scan/locations.ts`) but exports no function for it, so the
 * path is written here once.
 */
export function skillFilePath(claudeFolder: string, name: string): string {
  return join(claudeFolder, 'skills', name, 'SKILL.md')
}

/** Why Claude Code would refuse a skill folder of this name; undefined when it would load. */
export function skillNameRefusal(kind: SkillFolderKind, name: string): string | undefined {
  const { issues } = resolveSkillName({ origin: { kind }, dirName: name }, name)
  return issues.find((issue) => issue.severity === 'error')?.message
}

/** What the kit finds wrong with a `SKILL.md` text: a bad field, a refused name. */
export function skillFileIssues(
  path: string,
  text: string,
  kind: SkillFolderKind,
): readonly PluginIssue[] {
  const dirName = basename(join(path, '..'))
  return readSkill(path, text, { origin: { kind }, dirName }).issues
}

/** A skill folder of a container, without its body. */
export interface FolderSkill {
  readonly name: string
  readonly description: string
  /** The skill's folder. */
  readonly dir: string
  /** Its `SKILL.md`. */
  readonly path: string
}

/**
 * The skills of a folder that is not a scope's own (the curator's archive, a scope's
 * `.claude/skills` read alone): its immediate subfolders read as the kit reads a skills folder.
 */
export async function readSkillFolder(
  dir: string,
  kind: SkillFolderKind,
  signal?: AbortSignal,
): Promise<FolderSkill[]> {
  const outcome = await scanSkillContainer(
    diskFolderScan({ managedDirectory: undefined }),
    dir,
    '.',
    {
      scope: kind,
      origin: { kind },
      rootName: basename(dir),
      ...(signal ? { signal } : {}),
    },
  )
  return outcome.entries.flatMap(({ invocable }) =>
    invocable.kind === 'skill'
      ? [
          {
            name: invocable.name,
            description: invocable.description ?? '',
            dir: invocable.dir,
            path: invocable.path,
          },
        ]
      : [],
  )
}
