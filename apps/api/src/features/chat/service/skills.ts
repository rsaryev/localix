import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
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

  // ---- CC-compatible frontmatter fields (mirror of DiscoveredSkill CC section) --
  disableModelInvocation?: boolean
  userInvocable?: boolean
  argumentHint?: string
  argumentNames?: string[]
  allowedTools?: string[]
  disallowedTools?: string[]
  contextFork?: boolean
  forkAgent?: string
  preferredModel?: string
  preferredEffort?: string
  version?: string
  /** CC skill frontmatter `hooks` — raw CC hooks map, activated for the skill's run. */
  hooks?: unknown
}

export interface SkillInput {
  name: string
  description: string
  content: string
  tags?: string[]
  projectId?: string | null
}

/** Pick CC-compat optional fields from a DiscoveredSkill (undefined = omit). */
function pickCcFields(f: DiscoveredSkill): Partial<SkillRecord> {
  const out: Partial<SkillRecord> = {}
  if (f.disableModelInvocation) out.disableModelInvocation = true
  if (f.userInvocable === false) out.userInvocable = false
  if (f.argumentHint) out.argumentHint = f.argumentHint
  if (f.argumentNames?.length) out.argumentNames = f.argumentNames
  if (f.allowedTools?.length) out.allowedTools = f.allowedTools
  if (f.disallowedTools?.length) out.disallowedTools = f.disallowedTools
  if (f.contextFork) out.contextFork = true
  if (f.forkAgent) out.forkAgent = f.forkAgent
  if (f.preferredModel) out.preferredModel = f.preferredModel
  if (f.preferredEffort) out.preferredEffort = f.preferredEffort
  if (f.version) out.version = f.version
  if (f.hooks !== undefined) out.hooks = f.hooks
  return out
}

export function toFileSkillRecord(f: DiscoveredSkill, projectId: string): SkillRecord {
  const record: SkillRecord = {
    id: `file:${f.path}`,
    name: f.name,
    description: f.description,
    // Defined as a forwarding accessor below. Runtime slash-command lookup builds
    // records for the whole roster but should materialize only the selected body.
    content: '',
    tags: [],
    projectId: f.scope === 'project' ? projectId : '',
    scope: f.scope,
    source: 'file',
    path: f.path,
    updatedAt: '',
    ...pickCcFields(f),
  }
  Object.defineProperty(record, 'content', {
    configurable: false,
    enumerable: true,
    get: () => f.content,
  })
  return record
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
