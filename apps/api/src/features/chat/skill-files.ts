import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import { isPathWithin } from '../../lib/path-containment'
import { userHome } from '../../lib/env'
import { claudeConfigDir } from '../cc-settings/config-dir'
import { renderFrontmatterFile } from '../agent-core/frontmatter-yaml'
import { assertSkillMarkdownSize, readSkillMarkdownFile } from '../agent-core/skill-file'
import { recordSkillAuthored } from '../agent-core/skill-usage-recorder'
import { skillFilePath, skillNameRefusal, type SkillFolder } from '../plugins/kit'

/**
 * The skills Localix writes: the Skills list's create, edit and remove, and the `Skill` tool's
 * `save`. Where a skill of a scope goes and which names Claude Code takes are the kit's
 * (`plugins/kit/skill-files.ts`); the file itself is Localix's: a name that stays one folder, no
 * write through a symlink out of the folder, the frontmatter keys it does not set kept, the whole
 * file or nothing.
 */

/** A skill as the Skills list and the `Skill` tool hand it over. */
export interface SkillDraft {
  readonly name: string
  readonly description: string
  readonly content: string
}

/** One path segment Localix writes a skill folder under (and the Store asks for). */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

/** The `.claude` folder a skill of the scope is written to: the person's, or the project's. */
export function skillFolderOf(projectDir: string | null): SkillFolder {
  return projectDir
    ? { folder: join(projectDir, '.claude'), kind: 'project' }
    : { folder: claudeConfigDir(userHome()), kind: 'user' }
}

async function nearestExistingAncestor(path: string): Promise<string> {
  let current = path
  while (true) {
    try {
      return await fs.realpath(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

/** `dir` and what exists of it stay within `root` once symlinks are resolved. */
async function requireWithin(root: string, dir: string, verb: string): Promise<void> {
  const [canonicalRoot, canonical] = await Promise.all([
    nearestExistingAncestor(root),
    nearestExistingAncestor(dir),
  ])
  if (!isPathWithin(canonicalRoot, canonical))
    throw new Error(`Refusing to ${verb} skill through escaping symlink: ${dir}`)
}

/** The folder's existing `SKILL.md`, read; '' for a new skill. */
async function existingText(file: string): Promise<string | undefined> {
  try {
    await fs.access(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return readSkillMarkdownFile(file)
}

/** The file a draft becomes: its frontmatter merged into what the file had, the body replaced. */
export function renderSkillFile(existing: string, draft: SkillDraft): string {
  // The description is one line of YAML.
  const description = draft.description.replace(/[\r\n\t]+/g, ' ').trim()
  return renderFrontmatterFile(existing, { name: draft.name, description }, draft.content.trim())
}

/**
 * Writes `<folder>/skills/<name>/SKILL.md`, editing a file already there in place. Returns its path.
 * `authored`, when given, records a NEW skill as made in Localix (the curator archives only those).
 */
export async function writeSkill(
  target: SkillFolder,
  draft: SkillDraft,
  authored?: { projectId: string },
): Promise<string> {
  const refusal = SKILL_NAME_RE.test(draft.name)
    ? skillNameRefusal(target.kind, draft.name)
    : 'Invalid skill name'
  if (refusal) throw new Error(refusal)
  const file = skillFilePath(target, draft.name)
  // The folder's parent (the project, the person's home) bounds where a link may lead.
  const root = dirname(target.folder)
  await requireWithin(root, dirname(file), 'write')
  const existing = await existingText(file)
  const rendered = renderSkillFile(existing ?? '', draft)
  assertSkillMarkdownSize(rendered, file)
  await fs.mkdir(dirname(file), { recursive: true })
  await requireWithin(root, dirname(file), 'write')
  // Temp file and rename: a crash never leaves half a SKILL.md.
  await atomicWriteFile(file, rendered)
  if (existing === undefined && authored)
    recordSkillAuthored(
      draft.name,
      target.kind === 'project' ? 'project' : 'global',
      authored.projectId,
    )
  return file
}

/**
 * Removes the skill folder `name` of `<folder>/skills`; false when there is none. A skill of
 * another folder (`.agents/skills`, a plugin's) is not Localix's to remove.
 */
export async function removeSkill(target: SkillFolder, name: string): Promise<boolean> {
  if (!SKILL_NAME_RE.test(name)) return false
  const dir = dirname(skillFilePath(target, name))
  try {
    await fs.access(join(dir, 'SKILL.md'))
  } catch {
    return false
  }
  await requireWithin(dirname(target.folder), dir, 'remove')
  await fs.rm(dir, { recursive: true, force: true })
  return true
}
