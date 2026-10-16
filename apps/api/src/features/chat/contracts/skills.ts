import { z } from 'zod'

/**
 * The CATALOG projection of a skill: everything a list, a filter, or a palette
 * command needs, and nothing a reader has to scroll.
 *
 * Deliberately WITHOUT `content`. A skill body is arbitrary markdown — the largest
 * in a normal install run to tens of kilobytes each — and the capability snapshot is
 * fetched on every scope change and every capability mutation. Shipping bodies there
 * would make the one document every surface reads grow with the user's writing.
 * The editor asks for the full record when a skill is actually opened.
 */
export const skillSummarySchema = z.object({
  id: z.string(),
  /**
   * Whether this scope has the skill switched ON — the binary face of the stored
   * `skillOverrides` value ('off' is the only one that means "not available"). The
   * finer overrides ('name-only', 'user-invocable-only') narrow HOW the model sees a
   * skill that is on, and are not what a switch expresses.
   */
  enabled: z.boolean(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  /** '' = global; otherwise the project id this skill is scoped to. */
  projectId: z.string(),
  scope: z.enum(['global', 'project']),
  /** 'db' = managed in the UI; 'file' = a portable SKILL.md (read-only). */
  source: z.enum(['db', 'file']),
  path: z.string().optional(),
  updatedAt: z.string(),
  /** SKILL.md hygiene, so a list can flag a broken skill without opening it. */
  validation: z.object({ errors: z.array(z.string()), warnings: z.array(z.string()) }).optional(),
  // The invocation-shape fields a command palette needs to decide whether to offer
  // the skill at all and how to prompt for its argument.
  disableModelInvocation: z.boolean().optional(),
  userInvocable: z.boolean().optional(),
  argumentHint: z.string().optional(),
  argumentNames: z.array(z.string()).optional(),
})

export type SkillSummary = z.infer<typeof skillSummarySchema>

/**
 * A skill as its OWNER knows it: everything above except whether a given scope has it
 * switched on. That answer belongs to the scope's settings, so the capability snapshot
 * stamps it — the skills service never has to know which scope is asking.
 */
export type SkillCatalogEntry = Omit<SkillSummary, 'enabled'>
