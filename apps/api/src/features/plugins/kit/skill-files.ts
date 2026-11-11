import { basename } from 'node:path'
import { resolveSkillName } from '@rsaryev/llx-plugin/format'
import { scanSkillContainer, scopeFilePath } from '@rsaryev/llx-plugin/skills'
import { diskFolderScan } from './ports/folder-scan'

/**
 * The `SKILL.md` format as the kit reads it, for the code that writes skills outside a run (the
 * Skills list, the `Skill` tool's `save`, the curator's archive): what a skill of a scope is called,
 * where a new one goes and what is wrong with a file. The writes are Localix's
 * (`chat/skill-files.ts`); these say what Claude Code would make of them.
 */

/** The folder kinds Localix writes skills to: the person's `.claude` and a project's. */
export type SkillFolderKind = 'user' | 'project'

/** A `.claude` folder Localix writes skills to, and which scope it is. */
export interface SkillFolder {
  readonly folder: string
  readonly kind: SkillFolderKind
}

/**
 * Where a new skill named `name` of a `.claude` folder lives, by the kit's rule (`scopeFilePath`:
 * `<folder>/skills/<name>/SKILL.md`). Both scopes Localix writes to read skills, so there is a path.
 */
export function skillFilePath(target: SkillFolder, name: string): string {
  const path = scopeFilePath(target.kind, 'skill', target.folder, name)
  if (path === undefined) throw new Error(`The ${target.kind} scope reads no skills`)
  return path
}

/** Why Claude Code would refuse a skill folder of this name; undefined when it would load. */
export function skillNameRefusal(kind: SkillFolderKind, name: string): string | undefined {
  const { issues } = resolveSkillName({ origin: { kind }, dirName: name }, name)
  return issues.find((issue) => issue.severity === 'error')?.message
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
