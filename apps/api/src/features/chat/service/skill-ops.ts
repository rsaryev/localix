import { InvalidRequestError, NotFoundError } from '../../../lib/domain-errors'
import { basename, dirname } from 'node:path'

import type { ScopeSkills } from '../../plugins/kit'
import type { PluginIssue } from '@rsaryev/llx-plugin/format'
import { removeSkill, skillFolderOf, writeSkill } from '../skill-files'
import { toSkillRecord, type SkillInput, type SkillRecord } from './skills'

/** Closure values the skills CRUD operations need from createChatService. */
export interface SkillOpsContext {
  now: () => string
  resolveProjectWorkingDir: (userId: string, projectId: string | null) => Promise<string | null>
  /**
   * A scope's skills as the kit lists them (`plugins/kit` `scopeSkills`): the project's folders
   * with `projectId`, the person's alone without one, and the plugins the scope has on.
   */
  scopeSkills: (userId: string, projectId: string | null) => Promise<ScopeSkills>
}

/** A file's issues as the list flags them. */
function validationOf(issues: readonly PluginIssue[], path: string | undefined) {
  const own = issues.filter((issue) => issue.path === path)
  if (own.length === 0) return undefined
  const of = (severity: PluginIssue['severity']) =>
    own.filter((issue) => issue.severity === severity).map((issue) => issue.message)
  return { errors: of('error'), warnings: of('warning') }
}

/** The skills of the scope's own folders (a plugin's are its plugin's page), with their issues. */
async function folderSkills(ctx: SkillOpsContext, userId: string, projectId: string | null) {
  const listed = await ctx.scopeSkills(userId, projectId)
  return { listed, skills: listed.skills.filter((skill) => skill.source.kind !== 'plugin') }
}

/**
 * Lists the skills of a scope's own folders, as the kit reads them: with `projectId`, the
 * project's (its working directory up to the repository root) and the person's; without one, the
 * person's. Skills are never stored in the DB.
 */
export async function listSkills(
  ctx: SkillOpsContext,
  userId: string,
  opts?: { projectId?: string | null },
): Promise<{ skills: SkillRecord[] }> {
  const projectId = opts?.projectId ?? null
  const { listed, skills } = await folderSkills(ctx, userId, projectId)
  return {
    skills: skills.map((skill) => {
      const validation = validationOf(listed.issues, skill.file)
      return toSkillRecord(skill, projectId ?? '', validation ? { validation } : {})
    }),
  }
}

/**
 * Read ONE skill in full, body included.
 *
 * The list is a catalog — it rides in the capability snapshot as summaries, because a
 * skill body is arbitrary markdown and a catalog that carries every body grows with
 * the user's writing. This is the other half of that rule: the editor asks for the
 * body of the skill it is opening, and only that one.
 */
export async function getSkill(
  ctx: SkillOpsContext,
  userId: string,
  name: string,
  opts?: { projectId?: string | null },
): Promise<SkillRecord> {
  const projectId = opts?.projectId ?? null
  const { listed, skills } = await folderSkills(ctx, userId, projectId)
  const skill = skills.find((entry) => entry.invocable.command === name)
  const content = skill ? await listed.content(skill.invocable.command) : undefined
  if (!skill || content === undefined)
    throw new NotFoundError('skill_not_found', `Skill "${name}" not found`)
  const validation = validationOf(listed.issues, skill.file)
  return toSkillRecord(skill, projectId ?? '', { content, ...(validation ? { validation } : {}) })
}

/** The `.claude` folder a skill of the input's scope is written to. */
async function folderFor(ctx: SkillOpsContext, userId: string, projectId: string | null) {
  if (!projectId) return skillFolderOf(null)
  const dir = await ctx.resolveProjectWorkingDir(userId, projectId)
  if (!dir) throw new InvalidRequestError('no_project_dir', 'Project has no working directory')
  return skillFolderOf(dir)
}

/** Creates/overwrites a SKILL.md file (the project's `.claude`, or the person's). */
export async function createSkill(
  ctx: SkillOpsContext,
  userId: string,
  input: SkillInput,
): Promise<SkillRecord> {
  const target = await folderFor(ctx, userId, input.projectId ?? null)
  const path = await writeSkill(
    target,
    { name: input.name, description: input.description, content: input.content },
    { projectId: input.projectId ?? '' },
  )
  return {
    id: `file:${path}`,
    name: input.name,
    description: input.description,
    content: input.content,
    tags: input.tags ?? [],
    projectId: input.projectId ?? '',
    scope: input.projectId ? 'project' : 'global',
    source: 'file',
    path,
    updatedAt: ctx.now(),
  }
}

/**
 * The skill NAME encoded in a `file:<…>/<name>/SKILL.md` id. Name is the identity
 * throughout this subsystem: the write path writes to `<container>/<name>/`, and delete
 * looks a skill up by name — so the id's directory basename IS the skill's name. Returns
 * undefined for an id that does not fit the shape, so a caller falls back safely to
 * create-only behavior (never guessing a name to delete).
 */
export function skillNameFromId(id: string): string | undefined {
  if (!id.startsWith('file:')) return undefined
  const name = basename(dirname(id.slice('file:'.length)))
  return name && name !== '.' && name !== '/' ? name : undefined
}

/**
 * Edits an existing skill, identified by its `id`. A same-name edit rewrites the file in
 * place (preserving frontmatter); a RENAME writes a fresh `<newName>` directory and then
 * removes the original `<oldName>` one, which would otherwise linger as a shadowing duplicate.
 */
export async function updateSkill(
  ctx: SkillOpsContext,
  userId: string,
  id: string,
  input: Partial<SkillInput>,
): Promise<SkillRecord> {
  if (!input.name || !input.description || input.content === undefined) {
    throw new InvalidRequestError('invalid_skill', 'name, description and content are required')
  }
  const record = await createSkill(ctx, userId, input as SkillInput)
  const oldName = skillNameFromId(id)
  if (oldName && oldName !== input.name) {
    await removeSkill(await folderFor(ctx, userId, input.projectId ?? null), oldName)
  }
  return record
}

/** Deletes a skill by name from the scope's own `.claude/skills` (the project's, or the person's). */
export async function deleteSkill(
  ctx: SkillOpsContext,
  userId: string,
  name: string,
  projectId?: string | null,
): Promise<void> {
  await removeSkill(await folderFor(ctx, userId, projectId ?? null), name)
}
