import { createHash } from 'node:crypto'

import type { MiniAppInstallOutcome } from '../../mini-apps/store-activity'
import type { InboxAction, InboxOrigin } from '../contracts'
import type { NotificationJournal } from '../journal-contracts'

/**
 * FINISHED MINI APP INSTALLS AND UPDATES, as journal facts — recorded by the store (the owner)
 * through its `onJobsSettled` port when its queue drains, never derived by a window.
 *
 * The progress itself is not here: it is in-memory status the Event Center's "In progress" reads
 * live. What is left once a job ends is one short line: "Installed Notes", "Updated 3 mini apps",
 * or "Could not install Notes" with its reason and a Try again the window runs
 * (`mini_app_install`, the app's name in `requestId`). A later success settles that failure.
 */

const ORIGIN: InboxOrigin = { kind: 'application', label: 'Mini apps' }
const enc = encodeURIComponent

/** "Notes", "Notes and Tasks", "Notes, Ledger and Tasks". */
function names(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

const batchKey = (kind: string, outcomes: readonly MiniAppInstallOutcome[]) =>
  `mini-app-${kind}:${createHash('sha256')
    .update(outcomes.map((o) => `${o.name}@${o.version ?? ''}`).join('\n'))
    .digest('hex')
    .slice(0, 16)}`

const failurePrefix = (name: string) => `mini-app-failed:${enc(name)}:`

function retryAction(name: string): InboxAction {
  return {
    id: 'retry',
    label: 'Try again',
    kind: 'invoke',
    command: 'mini_app_install',
    requestId: name,
    available: true,
  }
}

export type MiniAppInstallFacts = (outcomes: readonly MiniAppInstallOutcome[]) => void

/** `defaultUser` receives the rows of what nobody asked for: a catalog's update. */
export function createMiniAppInstallFacts(
  journal: Pick<NotificationJournal, 'record' | 'settle'>,
  defaultUser: string,
): MiniAppInstallFacts {
  return (outcomes) => {
    const byUser = new Map<string, MiniAppInstallOutcome[]>()
    for (const outcome of outcomes) {
      const user = outcome.userId ?? defaultUser
      byUser.set(user, [...(byUser.get(user) ?? []), outcome])
    }
    for (const [user, mine] of byUser) {
      const ok = mine.filter((o) => !o.error)
      for (const done of ok)
        journal.settle(user, { prefix: failurePrefix(done.name), reason: 'fixed' })
      for (const kind of ['install', 'update'] as const) {
        const group = ok.filter((o) => o.kind === kind)
        if (group.length === 0) continue
        const verb = kind === 'install' ? 'Installed' : 'Updated'
        const one = group.length === 1 ? group[0] : undefined
        journal.record(user, {
          key: batchKey(kind, group),
          topic: 'application.notification',
          category: 'system',
          severity: 'success',
          title: one
            ? `${verb} ${one.label}${kind === 'update' && one.version ? ` to ${one.version}` : ''}`
            : `${verb} ${group.length} mini apps`,
          ...(one ? {} : { body: names(group.map((o) => o.label)) }),
          origin: ORIGIN,
        })
      }
      for (const failed of mine.filter((o) => o.error)) {
        journal.record(user, {
          key: `${failurePrefix(failed.name)}${enc(failed.version ?? '')}`,
          topic: 'application.notification',
          category: 'system',
          severity: 'error',
          title: `Could not ${failed.kind} ${failed.label}`,
          body: failed.error!,
          origin: ORIGIN,
          actions: [retryAction(failed.name)],
        })
      }
    }
  }
}
