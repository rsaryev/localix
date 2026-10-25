import { InvalidRequestError, NotFoundError } from '../../../lib/domain-errors'
import { homedir } from 'node:os'
import { basename, dirname } from 'node:path'

import {
  discoverFilesystemSkills,
  writeSkillFile,
  deleteSkillByName,
} from '../../agent-core/skill-discovery'
import { validateSkillFile } from '../../agent-core/skill-validate'
import { toFileSkillRecord, type SkillInput, type SkillRecord } from './skills'
import type { SkillDiscoveryLogger } from '../../agent-core/skill-discovery'

/** Closure values the skills CRUD operations need from createChatService. */
export interface SkillOpsContext {
  now: () => string
  resolveProjectWorkingDir: (userId: string, projectId: string | null) => Promise<string | null>
  logger?: SkillDiscoveryLogger
}

/**
 * Lists skills as SKILL.md files. With `projectId` it resolves that project's
 * working dir and walks up the tree (plus global home); without one, only
 * global skills. Skills are never stored in the DB.
 */
export async function listSkills(
  ctx: SkillOpsContext,
  userId: string,
  opts?: { projectId?: string | null },
): Promise<{ skills: SkillRecord[] }> {
  const workingDir = await ctx.resolveProjectWorkingDir(userId, opts?.projectId ?? null)
  const fileSkills = await discoverFilesystemSkills(workingDir, undefined, ctx.logger)
  // Attach per-skill SKILL.md hygiene (parallel, independent file reads) so the
  // settings UI can surface bad/missing frontmatter without a chat round-trip.
  const skills = await Promise.all(
    fileSkills.map(async (f) => ({
      ...toFileSkillRecord(f, opts?.projectId ?? ''),
      validation: await validateSkillFile(f.path),
    })),
  )
  return { skills }
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
  const { skills } = await listSkills(ctx, userId, opts)
  const skill = skills.find((entry) => entry.name === name)
  if (!skill) throw new NotFoundError('skill_not_found', `Skill "${name}" not found`)
  return skill
}

/** Creates/overwrites a SKILL.md file (project working dir, or home for global). */
export async function createSkill(
  ctx: SkillOpsContext,
  userId: string,
  input: SkillInput,
): Promise<SkillRecord> {
  const base = input.projectId
    ? await ctx.resolveProjectWorkingDir(userId, input.projectId)
    : homedir()
  if (!base) throw new InvalidRequestError('no_project_dir', 'Project has no working directory')
  const dir = await writeSkillFile(
    base,
    { name: input.name, description: input.description, content: input.content },
    input.projectId ? 'project' : 'global',
    { projectId: input.projectId ?? '' },
  )
  return {
    id: `file:${dir}/SKILL.md`,
    name: input.name,
    description: input.description,
    content: input.content,
    tags: input.tags ?? [],
    projectId: input.projectId ?? '',
    scope: input.projectId ? 'project' : 'global',
    source: 'file',
    path: `${dir}/SKILL.md`,
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
 * place (via {@link writeSkillFile}, preserving frontmatter); a RENAME writes a fresh
 * `<newName>` directory and then removes the original `<oldName>` one — which the old
 * create-only implementation left behind as a shadowing duplicate.
 *
 * Not yet reachable from an HTTP route: the Settings UI edit still POSTs `createSkill`,
 * so a UI rename currently orphans the old skill. Wiring this in (a PUT route +
 * `updateSkill` client method + the edit form calling it with the original id) is the
 * remaining end-to-end step.
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
    // The rename wrote a new `<newName>` dir; delete the original by its (old) name so it
    // does not linger as a second, shadowing skill. Scoped exactly like deleteSkill.
    const workingDir = input.projectId
      ? await ctx.resolveProjectWorkingDir(userId, input.projectId)
      : null
    await deleteSkillByName(workingDir, oldName)
  }
  return record
}

/** Deletes a skill by name, scoped to the given project (or global). */
export async function deleteSkill(
  ctx: SkillOpsContext,
  userId: string,
  id: string,
  projectId?: string | null,
): Promise<void> {
  const workingDir = projectId ? await ctx.resolveProjectWorkingDir(userId, projectId) : null
  await deleteSkillByName(workingDir, id)
}
