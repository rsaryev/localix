/**
 * Owning a standing problem: publish it while it is true, settle it when it is not.
 *
 * This exists because four features invented it independently within a day — `useDbProblem`,
 * `useReaderProblem`, `useVaultProblem`, `SettingProblems` — and each rediscovered the same trap on
 * the way. The trap: publishing from inside `{error && <ProblemLine/>}` never settles anything. The
 * component that owns the condition is the only thing that can say it ended, and that component is
 * unmounted precisely when the condition ends. So the Event Center keeps asserting a failure that
 * was fixed ten minutes ago, and the only way out was for every call site to remember to render its
 * problem surface in the HEALTHY state too — a rule nothing enforced.
 *
 * A hook cannot be called conditionally, so moving ownership here makes the correct thing the only
 * thing: pass `null` when nothing is wrong and the row settles itself.
 *
 * WHAT THIS DOES NOT DO: it does not settle on unmount, and that is deliberate. A durable record
 * exists so a problem can be found after you stop looking at it; erasing it because the tab closed
 * would delete exactly the case the centre is for. So the OWNER must stay mounted and pass `null` —
 * `{broken && <Owner/>}` is still wrong, and no hook can fix that without breaking the other half.
 * Mount the owner unconditionally; branch on what it renders, not on whether it exists.
 */

import { useEffect, useRef, useState } from 'react'

import { toast, type PluginProblemsOptions } from './notifications'
import { problemSubjectKey, type ProblemRecovery, type ProblemReport } from './problems'

export interface OwnedProblemReport {
  report: ProblemReport
  /** Event Center row for this report; give it to `ProblemLine` so "Details" lands on it. */
  entryId?: string
  /**
   * The recovery from `options.actions`, handed back so the line renders the SAME list the durable
   * row got. Spreading the result (`<ProblemLine {...problem} />`) is therefore the whole call
   * site: nothing is mapped to markup by hand, and nothing can be offered in one place only.
   */
  actions?: readonly ProblemRecovery[]
}

/** Live owners per `scope:subject`, so a second one can be named rather than silently fought. */
const owners = new Map<string, number>()

/**
 * Publish `report` for as long as it is non-null, and settle it when it becomes null.
 *
 * Returns what a surface needs to render, or null when there is nothing to say — so the call site
 * reads `{problem && <ProblemLine {...problem} />}` with no second condition and no way to forget
 * the healthy branch.
 *
 * ONE OWNER PER SUBJECT. Settling resolves every row for `scope:subject`, so two components
 * publishing the same subject will settle each other. Hoist the report to their common parent —
 * and the check below says so out loud, because this was found the hard way: two views of the same
 * database both published "saved connections", and in embedded mode both mounted.
 */
export function useProblemReport(
  report: ProblemReport | null,
  options: PluginProblemsOptions,
): OwnedProblemReport | null {
  const [entryId, setEntryId] = useState<string | undefined>(undefined)
  const subjectKey = report ? problemSubjectKey(options.scope, report.subject) : null
  useEffect(() => {
    if (!subjectKey) return
    const count = (owners.get(subjectKey) ?? 0) + 1
    owners.set(subjectKey, count)
    if (count > 1) {
      console.warn(
        `[problem-report] two components own "${subjectKey}". They will settle each other's Event Center row — hoist the report to their common parent.`,
      )
    }
    return () => {
      const remaining = (owners.get(subjectKey) ?? 1) - 1
      if (remaining > 0) owners.set(subjectKey, remaining)
      else owners.delete(subjectKey)
    }
  }, [subjectKey])
  const publisher = useRef<ProblemPublisher | null>(null)
  const settings = useRef(options)
  settings.current = options

  // The report is rebuilt every render; its CONTENT is what decides whether to republish. A
  // problem's `request` is left out: a poll that keeps failing names a NEW request every tick, and
  // the same failure must not be republished each time — the first request is the cause on record.
  const fingerprint = report
    ? JSON.stringify([
        report.subject,
        report.consequence,
        report.title,
        report.problems.map(({ request: _request, ...problem }) => problem),
      ])
    : null

  useEffect(() => {
    publisher.current ??= createProblemPublisher()
    setEntryId(publisher.current(report, settings.current))
    // `report` itself is a fresh object each render; the fingerprint is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint])

  return report ? { report, entryId, actions: options.actions } : null
}

export type ProblemPublisher = (
  report: ProblemReport | null,
  options: PluginProblemsOptions,
) => string | undefined

/**
 * The hook's memory between effects: what it last SAID, so it settles exactly that.
 *
 * The defect this shape stops: an owner whose subject changes while staying broken — the
 * database view switching from one broken connection to another — used to overwrite its record
 * of what it had published and publish the new subject, so the OLD subject's row was never
 * settled and kept asserting a failure nobody owned any more. Settling happens whenever the
 * published subject stops being the current one, whether the report went null or moved.
 *
 * It also never touches the centre to clear something it never said.
 */
export function createProblemPublisher(): ProblemPublisher {
  let published: { report: ProblemReport; scope: string } | null = null
  return (report, options) => {
    const previous = published
    published = report ? { report, scope: options.scope } : null
    const moved =
      previous !== null &&
      (report === null ||
        problemSubjectKey(previous.scope, previous.report.subject) !==
          problemSubjectKey(options.scope, report.subject))
    if (previous && moved) toast.problemsCleared(previous.report, previous.scope)
    return report ? (toast.problems(report, options) ?? undefined) : undefined
  }
}
