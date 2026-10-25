import { createHash } from 'node:crypto'

import { recoveryAction } from '../recovery'
import type { InboxOrigin } from '../contracts'
import type { NotificationJournal } from '../journal-contracts'

/**
 * SKILLS THE WEEKLY CURATOR PASS ARCHIVED, as a journal fact — recorded when the curator (the
 * owner) reports a pass through its `onArchived` port, so the person who never opened Skills still
 * learns that something moved, and where to get it back. A pass that archived nothing says nothing.
 *
 * One line per pass: "Archived the review skill" or "Archived 3 unused skills" naming them. The
 * action opens the skill's own Store page (several: the skills), where Restore is.
 */

const ORIGIN: InboxOrigin = { kind: 'application', label: 'Skills' }
/** Names shown in the body before "and N more". */
const SHOWN = 10

function list(names: readonly string[]): string {
  const shown = names.slice(0, SHOWN)
  const more = names.length - shown.length
  if (more > 0) return `${shown.join(', ')} and ${more} more`
  return shown.length <= 1
    ? (shown[0] ?? '')
    : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

export type SkillArchiveFacts = (userId: string, names: readonly string[]) => void

export function createSkillArchiveFacts(
  journal: Pick<NotificationJournal, 'record'>,
  now: () => Date = () => new Date(),
): SkillArchiveFacts {
  return (userId, names) => {
    const [only] = names
    if (only === undefined) return
    // A pass is at least a week after the last, so its day and its skills are its identity.
    const key = `skills-archived:${now().toISOString().slice(0, 10)}:${createHash('sha256')
      .update(names.join('\n'))
      .digest('hex')
      .slice(0, 12)}`
    const one = names.length === 1
    journal.record(userId, {
      key,
      topic: 'application.notification',
      category: 'system',
      severity: 'info',
      title: one
        ? `Archived the ${only} skill: it was not used for a while`
        : `Archived ${names.length} unused skills`,
      ...(one ? {} : { body: list(names) }),
      origin: ORIGIN,
      actions: [
        one
          ? recoveryAction(`open-store:skill/user:${only}`, 'Open to restore')
          : recoveryAction('open-store:skill', 'Open skills'),
      ],
    })
  }
}
