import {
  problemReportDedupeKey,
  problemReportTitle,
  problemSubjectKey,
  sortProblems,
  worstProblemSeverity,
  type Problem,
  type ProblemLocation,
  type ProblemRecovery,
  type ProblemReport,
  type ProblemSubject,
} from '@localixai/mini-app-sdk/ui/problems'

import { recordClientFact } from './clientFacts'
import { boundedKeyPart } from './inboxMapping'
import { refreshJournalView } from './journal'
import { setOverlay } from './overlay'
import { resolveNotificationCondition, useNotificationsStore } from './store'
import type { NotificationAction, NotificationOrigin } from './types'

/**
 * Standing problems, in the Event Center.
 *
 * The gap this closes was reported plainly: a board file had two problems, the canvas said so, and
 * the notification centre said nothing. Every surface that could detect a problem was reporting it
 * only to whoever happened to be looking at that surface, which means a problem you were not
 * watching was a problem you never learned about — and, for an agent-driven product, that is most
 * of them.
 *
 * So a problem report has two destinations, always: the surface it belongs to (a banner or a
 * notice), and the durable centre. This module is the second one. It is deliberately thin — it owns
 * identity, wording and the open action, and delegates the record to the same journal every other
 * fact uses (`clientFacts.ts`).
 */

/** Problems beyond this are counted rather than listed; a centre row is a summary, not a report. */
const BODY_LINES = 6

export interface PublishProblemsOptions {
  /** Namespace for the condition identity — a plugin or feature id, e.g. `database`. */
  scope: string
  origin?: NotificationOrigin
  /** Opens the subject at a problem. When given, the entry carries an "Open" action. */
  onOpen?: (location: ProblemLocation) => void
  /**
   * The ways out of this problem — the same list the surface line renders. Without them the durable
   * record is read-only, so a problem found an hour later sends the person back to a surface they
   * may have closed. Anything marked `durable: false` is dropped here: dismissing a line, or
   * destroying the thing that failed, only means something while looking at it.
   */
  actions?: readonly ProblemRecovery[]
  /**
   * Whether the surface that owns this report is on screen right now. A visible report is recorded
   * without an unread badge — the person is already looking at it.
   */
  sourceVisible?: boolean
  /** Who reported it — a plugin's display name — as a label on the derived origin (`notify.ts`). */
  source?: string
}

/**
 * `application.condition:<scope>:<subject>:` — everything published about one subject.
 *
 * Every dedupe key this module mints starts with it, which is what makes settling a subject a
 * prefix match rather than a list of ids nobody could keep in sync.
 */
function conditionPrefix(scope: string, subject: ProblemSubject): string {
  return `application.condition:${boundedKeyPart(problemSubjectKey(scope, subject))}:`
}

/** The report's own key: its subject's prefix, then a fingerprint of exactly these problems. */
function reportKey(scope: string, report: ProblemReport): string {
  const subjectKey = problemSubjectKey(scope, report.subject)
  const fingerprint = problemReportDedupeKey(scope, report).slice(subjectKey.length + 1)
  return `${conditionPrefix(scope, report.subject)}${boundedKeyPart(fingerprint)}`
}

/**
 * The full report, as the centre row's body.
 *
 * This is the only place the detail is written out, because it is the only place a person can come
 * back to. Each problem keeps all three of its parts — where, what, and what to write instead —
 * since dropping the fix is what turned "Invalid input" into a dead end.
 */
/**
 * What an operator searches for: the producer's code, the call that failed and the id the API log
 * filed it under — `engine_unavailable · GET /rpc/acme/items → 503 · request 7f3a…`. The code
 * used to ride in `field`, which printed it as a location in front of the sentence.
 */
function contextLine(problem: Problem): string {
  const request = problem.request
  const call = request?.path
    ? `${request.method ?? 'GET'} ${request.path}${request.status !== undefined ? ` → ${request.status}` : ''}`
    : undefined
  return [problem.code, call, request?.requestId && `request ${request.requestId}`]
    .filter(Boolean)
    .join(' · ')
}

function bodyOf(report: ProblemReport): string {
  const ordered = sortProblems(report.problems)
  const lines = ordered.slice(0, BODY_LINES).flatMap((problem) => {
    const where = [problem.field, problem.location?.line && `line ${problem.location.line}`]
      .filter(Boolean)
      .join(' ')
    const head = where ? `${where} — ${problem.message}` : problem.message
    const context = contextLine(problem)
    return [
      head,
      ...(problem.hint ? [`  → ${problem.hint}`] : []),
      // The engine's exact words, indented under the sentence that classified them. This is the one
      // place with room for them; the surface line is deliberately not.
      ...(problem.detail && problem.detail !== problem.message ? [`  ${problem.detail}`] : []),
      ...(context ? [`  ${context}`] : []),
    ]
  })
  const rest = ordered.length - Math.min(ordered.length, BODY_LINES)
  if (rest > 0) lines.push(`…and ${rest} more`)
  return lines.join('\n')
}

function openAction(
  report: ProblemReport,
  onOpen: NonNullable<PublishProblemsOptions['onOpen']>,
): NotificationAction {
  const first = sortProblems(report.problems)[0]
  const location = { path: report.subject.path, ...first?.location }
  return {
    id: 'open-problem',
    label: location.line ? `Open ${report.subject.label}:${location.line}` : 'Open',
    kind: 'callback',
    onClick: () => onOpen(location),
    available: true,
  }
}

function entryActions(
  report: ProblemReport,
  options: PublishProblemsOptions,
): NotificationAction[] | undefined {
  const actions: NotificationAction[] = [
    ...(options.onOpen ? [openAction(report, options.onOpen)] : []),
    // Every problem can go to the agent. The report already says what is wrong, where, and what to
    // write instead — retyping that into the composer was the person doing the app's job for it.
    {
      id: 'send-to-agent',
      label: 'Send to agent',
      kind: 'invoke' as const,
      command: 'send_to_agent',
      available: true,
    },
    ...(options.actions ?? [])
      .filter((action) => action.durable !== false)
      .map((action) => ({
        id: action.id,
        label: action.label,
        kind: 'callback' as const,
        onClick: () => void action.run(),
        available: true,
      })),
  ]
  return actions.length ? actions : undefined
}

/**
 * Record (or update) the standing problems of one subject.
 *
 * Republishing the same problems is idempotent: same identity, one row, read state preserved. When
 * the problems CHANGE, the new set becomes the live row and the superseded ones settle, so the
 * centre never accumulates a history of intermediate broken states nobody can act on.
 *
 * The raise and the settle are two ops in ONE ordered stream (`outbox.ts`), applied by the server
 * in the order they were made — so the newest report is the one kept however fast they come. (It
 * used to be two async deliveries, and two publishes in one tick could settle the newer row.)
 */
export function publishProblemReport(
  report: ProblemReport,
  options: PublishProblemsOptions,
): string | undefined {
  if (!report.problems.length) {
    clearProblemReport(report, options.scope)
    return undefined
  }
  const prefix = conditionPrefix(options.scope, report.subject)
  const candidate = reportKey(options.scope, report)
  // A surface republishes on every save and watch tick. When this exact report is already the one
  // open row of its subject, both ops would be no-ops on the server — only the callbacks, which
  // close over the surface's newest state, need replacing.
  if (isAlreadyStanding(prefix, candidate)) {
    setOverlay(candidate, entryActions(report, options) ?? [])
    refreshJournalView()
    return candidate
  }
  const key = recordClientFact({
    key: candidate,
    condition: true,
    // The severity is the PROBLEM's, never the surface's. An earlier version downgraded an error to
    // a warning whenever the pane could still paint its last good state, which filed a failed save
    // as a warning — the write failed either way. What the surface can still show decides only
    // whether this is worth interrupting the person for, below.
    severity: worstProblemSeverity(report.problems),
    title: problemReportTitle(report),
    body: bodyOf(report),
    // The failed calls the producer named: they ARE the trace, so nothing nearby is guessed in.
    causes: report.problems.flatMap((problem) => (problem.request ? [problem.request] : [])),
    origin: options.origin,
    originLabel: options.source,
    actions: entryActions(report, options),
    sourceVisible: options.sourceVisible ?? false,
    // Only a surface that produced NOTHING is worth an OS-level interruption. A stale-but-working
    // surface stays inside the app.
    ...(report.consequence === 'blocked' ? { nativeKind: 'run' as const } : {}),
  })
  resolveNotificationCondition(prefix, key)
  // The key is the surface's link into the centre: "Details" must land on this row, not a list.
  return key
}

function isAlreadyStanding(prefix: string, key: string): boolean {
  const open = useNotificationsStore
    .getState()
    .entries.filter((entry) => entry.resolvedAt == null && entry.id.startsWith(prefix))
  return open.length === 1 && open[0]!.id === key
}

/** The subject validates again: settle everything the centre still says about it. */
export function clearProblemReport(report: Pick<ProblemReport, 'subject'>, scope: string): void {
  resolveNotificationCondition(conditionPrefix(scope, report.subject))
}
