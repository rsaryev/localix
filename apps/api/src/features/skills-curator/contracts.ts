import { z } from 'zod'

/**
 * Skills curator — background maintenance for filesystem skills.
 * Tracks per-skill usage, moves long-unused skills into a recoverable sibling
 * `.archive/` folder inside their skills root, and exposes pin/unpin so a user
 * can exempt a skill from auto-transitions. Bundled/plugin skills are never
 * touched — the curator only manages SKILL.md directories the discovery walk
 * finds in Localix-owned `.localix/skills` trees.
 */

export const skillLifecycleStates = ['active', 'stale', 'archived'] as const
export type SkillLifecycleState = (typeof skillLifecycleStates)[number]

export const curatorSkillRecordSchema = z.object({
  name: z.string(),
  description: z.string(),
  scope: z.enum(['project', 'global']),
  /** Absolute path to the skill directory (archived skills point into `.archive/`). */
  dir: z.string(),
  getCount: z.number(),
  lastUsedAt: z.string().nullable(),
  pinned: z.boolean(),
  archivedAt: z.string().nullable(),
  state: z.enum(skillLifecycleStates),
})
export type CuratorSkillRecord = z.infer<typeof curatorSkillRecordSchema>

export const curatorReportSchema = z.object({
  /** Skills left active after the pass. */
  active: z.number(),
  /** Skills that met the staleness rule this pass (pinned ones excluded). */
  stale: z.number(),
  /** Total skills sitting in `.archive/` after the pass. */
  archived: z.number(),
  /** Names archived by THIS pass. */
  archivedNow: z.array(z.string()),
})
export type CuratorReport = z.infer<typeof curatorReportSchema>

export const runCuratorRequestSchema = z.object({
  projectId: z.string().nullable().optional(),
})
