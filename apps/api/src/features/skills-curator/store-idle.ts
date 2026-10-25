import type { ItemAction, Scope, ShelfPlan } from '@localixai/store'

import type { CuratorSkillRecord } from './contracts'
import { CURATOR_INTERVAL_DAYS, DAY_MS } from './staleness'

/**
 * HOW THE STORE SAYS A SKILL IS UNUSED (`docs/internals/store.md`, "Skills"): the shelf action's
 * preview, and the note on a skill's page. Both read what the curator knows
 * (`CuratorSkillRecord.idleSince`, `staleAt`, `archiveOn`); the rule itself is `staleness.ts`.
 */

export const ARCHIVE_UNUSED: ItemAction = {
  id: 'archive-unused',
  label: 'Archive unused',
  help: 'See which skills are unused, then archive them; restore any of them later',
}

/** A page warns this long before the pass that archives the skill: two scheduled intervals. */
const WARN_DAYS = CURATOR_INTERVAL_DAYS * 2

const days = (from: string, nowMs: number) =>
  Math.max(0, Math.floor((nowMs - Date.parse(from)) / DAY_MS))
const dayCount = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** The skills of one shelf the pass would archive now, each with why, for the person to confirm. */
export function archiveUnusedPlan(skills: readonly CuratorSkillRecord[], nowMs: number): ShelfPlan {
  const stale = skills.filter((skill) => skill.state === 'stale')
  return {
    summary:
      stale.length === 0
        ? 'Nothing is unused: every skill here was used lately or is pinned.'
        : 'These skills have not been used in a while. Archiving takes them out of use; restore any of them later.',
    items: stale.map((skill) => {
      const idle = days(skill.idleSince ?? new Date(nowMs).toISOString(), nowMs)
      return {
        ref: {
          kind: 'skill',
          id: `${skill.scope === 'project' ? 'project' : 'user'}:${skill.name}`,
        },
        name: skill.name,
        reason: skill.lastUsedAt
          ? `Last used ${dayCount(idle)} ago`
          : `Never used, ${dayCount(idle)} old`,
      }
    }),
  }
}

/**
 * What a skill's page says when it is stale or about to be: how long it has been idle, and what
 * happens to it unless it is pinned. A personal skill is archived by the scheduled pass on
 * `archiveOn`; a project's is not archived on its own, so its page says where to do it.
 */
export function unusedNote(skill: CuratorSkillRecord, scope: Scope, nowMs: number): string | null {
  if (!skill.idleSince || !skill.staleAt) return null
  const idle = days(skill.idleSince, nowMs)
  const said = skill.lastUsedAt
    ? `Not used for ${dayCount(idle)}.`
    : `Never used, made ${dayCount(idle)} ago.`
  if (skill.archiveOn) {
    if (Date.parse(skill.archiveOn) - nowMs > WARN_DAYS * DAY_MS) return null
    return `${said} Archived on ${dateOf(skill.archiveOn)} unless pinned.`
  }
  if (scope === 'project' && Date.parse(skill.staleAt) <= nowMs)
    return `${said} Archive unused on the Project shelf would archive it unless pinned.`
  return null
}
