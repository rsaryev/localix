import { createHash } from 'node:crypto'

import type { NotificationSeverity } from '@localixai/notifications'

import type { InboxAction, InboxOrigin, SettleReason } from '../contracts'
import type { NotificationJournal } from '../journal'

/**
 * A STANDING CONDITION — a problem a person has to fix — as the server records it.
 *
 * Every producer below (plugins, MCP, loops, providers, language servers) used to say "this is
 * broken" only in the server log, which nobody reads, so a server that never connected or a plugin
 * that never loaded looked exactly like one that was fine. Each one now names WHAT is wrong at the
 * seam where it learns it, and the journal keeps one row per problem.
 *
 * Identity is what forces the shape. A row is keyed by its SUBJECT (the thing that is broken:
 * `plugin:<name>:load:<scope>`) plus a FINGERPRINT of the problem, because the journal treats an open
 * row as unchanged when the same key is raised again (`projection.ts`). So:
 *
 *   - the same problem republished while open is one row, however often the seam fires;
 *   - a DIFFERENT problem of the same subject is a new row, and the old one settles as superseded;
 *   - the subject working again settles everything under its prefix as fixed;
 *   - the same problem coming back after that reopens its row with the count advanced.
 *
 * Every key part is `encodeURIComponent`-ed and every prefix ends in `:`, so settling
 * `condition:plugin:a:` can never reach `condition:plugin:ab:` or a name that contained a colon.
 */

export type ConditionJournal = Pick<
  NotificationJournal,
  'record' | 'settle' | 'flush' | 'repository'
>

export interface ConditionRaise {
  /** The broken thing, most general part first: `['mcp', name, projectId]`. */
  subject: readonly string[]
  /** The text that identifies the problem; defaults to `body ?? title`. */
  problem?: string
  severity: NotificationSeverity
  title: string
  body?: string
  origin: InboxOrigin
  /**
   * What the person can do about it — at least one, by type. A condition is "a problem a
   * person has to fix", and every producer here once raised its row with no control at all, so
   * the person learned an MCP server was broken and then had to find where it is configured.
   * `recoveryAction` (`../recovery.ts`) builds the settings and sign-in destinations.
   */
  actions: readonly [InboxAction, ...InboxAction[]]
}

export interface Conditions {
  raise(userId: string, condition: ConditionRaise): void
  /** The subject works again (or is gone): settle every open row about it. */
  clear(userId: string, subject: readonly string[], reason?: SettleReason): void
  /**
   * Settle every open row under `subject` whose decoded key parts `keep` rejects — the rows about
   * things that no longer exist (a plugin since disabled), which no seam will ever clear.
   */
  sweep(
    userId: string,
    subject: readonly string[],
    keep: (parts: readonly string[]) => boolean,
    reason?: SettleReason,
  ): Promise<void>
}

export function subjectPrefix(subject: readonly string[]): string {
  return `condition:${subject.map((part) => encodeURIComponent(part)).join(':')}:`
}

/**
 * The problem's identity. Long digit runs (ports, pids, timestamps, a timeout's milliseconds) are
 * folded, or a server that fails the same way on every attempt would mint a new row each time.
 * Short numbers stay: a 401 and a 500 are different problems.
 */
export function problemFingerprint(problem: string): string {
  const normalized = problem
    .toLowerCase()
    .replace(/\d{4,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

/** One line, no trailing full stop, a capital first letter, and short enough to be a headline. */
export function headline(text: string, max = 120): string {
  const line = (text.split('\n')[0] ?? '').trim().replace(/[.!]+$/u, '')
  const cut = line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
  return cut.charAt(0).toUpperCase() + cut.slice(1)
}

export function createConditions(journal: ConditionJournal): Conditions {
  /**
   * What this process last said per `user + prefix`: the open key, or null for "clear". Seams like
   * the per-run plugin load fire on every turn; without this each turn would cost a journal
   * transaction to learn nothing changed. Unknown (after boot) always goes to the journal, whose
   * idempotency makes that safe.
   */
  const saidByUser = new Map<string, Map<string, string | null>>()
  const saidFor = (userId: string) => {
    let said = saidByUser.get(userId)
    if (!said) saidByUser.set(userId, (said = new Map()))
    return said
  }

  return {
    raise(userId, condition) {
      const said = saidFor(userId)
      const prefix = subjectPrefix(condition.subject)
      const key = `${prefix}${problemFingerprint(condition.problem ?? condition.body ?? condition.title)}`
      if (said.get(prefix) === key) return
      // An ancestor remembered as clear is not clear any more.
      for (const known of said.keys()) if (prefix.startsWith(known)) said.delete(known)
      said.set(prefix, key)
      journal.record(userId, {
        key,
        topic: 'application.notification',
        category: 'system',
        severity: condition.severity,
        title: condition.title,
        ...(condition.body ? { body: condition.body } : {}),
        origin: condition.origin,
        actions: [...condition.actions],
        condition: true,
      })
      // Queued behind the raise, so the new row exists before its predecessors settle.
      journal.settle(userId, { prefix, keep: key, reason: 'superseded' })
    },

    clear(userId, subject, reason = 'fixed') {
      const said = saidFor(userId)
      const prefix = subjectPrefix(subject)
      if (said.get(prefix) === null) return
      // Everything under this subject is settled by the one prefix settle below.
      for (const known of said.keys()) if (known.startsWith(prefix)) said.delete(known)
      said.set(prefix, null)
      journal.settle(userId, { prefix, reason })
    },

    async sweep(userId, subject, keep, reason = 'cancelled') {
      const prefix = subjectPrefix(subject)
      await journal.flush()
      const open = await journal.repository.transaction((trx) =>
        journal.repository.openUnderPrefix(trx, userId, prefix),
      )
      const said = saidFor(userId)
      for (const entry of open) {
        const parts = entry.key.slice(prefix.length).split(':').map(decodeURIComponent)
        if (keep(parts)) continue
        // Forget what was said about the swept row, so the same problem raised again reopens it.
        for (const [known, value] of said) if (value === entry.key) said.delete(known)
        journal.settle(userId, { key: entry.key, reason })
      }
    },
  }
}
