import type { ChatSkill } from '../../plugins/kit'
import type { SkillCatalogEntry } from '../contracts/skills'

export interface SkillRecord {
  id: string
  name: string
  description: string
  content: string
  tags: string[]
  /** '' = global; otherwise the project id this skill is scoped to. */
  projectId: string
  scope: 'global' | 'project'
  /** 'db' = managed in the UI; 'file' = a portable SKILL.md (read-only here). */
  source: 'db' | 'file'
  path?: string
  updatedAt: string
  /**
   * SKILL.md hygiene (bad/missing frontmatter, contradictory fields, unreadable
   * file). Attached per file skill by `listSkills`; absent for db-managed skills.
   */
  validation?: { errors: string[]; warnings: string[] }

  // The invocation shape a palette needs, as the kit reads the file.
  disableModelInvocation?: boolean
  userInvocable?: boolean
  argumentHint?: string
  argumentNames?: string[]
}

export interface SkillInput {
  name: string
  description: string
  content: string
  tags?: string[]
  projectId?: string | null
}

/**
 * A skill of a scope's own folders as the Skills list shows it, from the kit's row. Its body is
 * `content` when read (one skill's, when the editor opens it), '' in a listing.
 */
export function toSkillRecord(
  skill: ChatSkill,
  projectId: string,
  extra: { content?: string; validation?: SkillRecord['validation'] } = {},
): SkillRecord {
  return {
    id: `file:${skill.path ?? skill.name}`,
    name: skill.name,
    description: skill.description,
    content: extra.content ?? '',
    tags: [],
    projectId: skill.scope === 'project' ? projectId : '',
    scope: skill.scope,
    source: 'file',
    ...(skill.path ? { path: skill.path } : {}),
    updatedAt: '',
    ...(extra.validation ? { validation: extra.validation } : {}),
    ...(skill.modelInvocable ? {} : { disableModelInvocation: true }),
    ...(skill.userInvocable ? {} : { userInvocable: false }),
    ...(skill.argumentHint ? { argumentHint: skill.argumentHint } : {}),
    ...(skill.argumentNames.length ? { argumentNames: [...skill.argumentNames] } : {}),
  }
}

/**
 * Project a full record onto its catalog entry — the shape the capability snapshot
 * carries, minus the per-scope `enabled` the snapshot stamps on. One function, so a
 * field can never appear in the snapshot meaning something else than in the record it
 * came from.
 */
export function toSkillSummary(skill: SkillRecord): SkillCatalogEntry {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    projectId: skill.projectId,
    scope: skill.scope,
    source: skill.source,
    ...(skill.path === undefined ? {} : { path: skill.path }),
    updatedAt: skill.updatedAt,
    ...(skill.validation === undefined ? {} : { validation: skill.validation }),
    ...(skill.disableModelInvocation === undefined
      ? {}
      : { disableModelInvocation: skill.disableModelInvocation }),
    ...(skill.userInvocable === undefined ? {} : { userInvocable: skill.userInvocable }),
    ...(skill.argumentHint === undefined ? {} : { argumentHint: skill.argumentHint }),
    ...(skill.argumentNames === undefined ? {} : { argumentNames: skill.argumentNames }),
  }
}
