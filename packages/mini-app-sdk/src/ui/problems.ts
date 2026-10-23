/**
 * One shape for "something is wrong, and here is where".
 *
 * Every layer of the product had its own answer to this: LSP diagnostics are a numeric severity and
 * a range, a board file reports a dotted field and a line, a settings form reports a sentence, a
 * failed request reports an `Error`. They rendered four different ways, and none of them reached the
 * Event Center — so a problem you were not looking at when it happened was a problem you never saw.
 *
 * This module is the domain-free middle: the smallest description of a problem that a list row, a
 * pane placeholder and a durable notification can ALL render without knowing which layer produced
 * it. It is types and pure functions only — no React, no host — so the backend, the SDK and the app
 * can each speak it.
 *
 * The rule the shape encodes: a problem is not a string. It is WHERE (subject + field + line), WHAT
 * (message), WHAT TO DO (hint), and — separately from all of those — what the engine ACTUALLY SAID
 * (detail), so classifying a failure into a readable sentence never costs an operator the exact
 * text. A report additionally says what the person is looking at while the problem stands, because
 * "your edit is not on screen" and "the screen is empty" are different situations and deserve
 * different words, and how to get out of it, so the surface and the durable record offer the same
 * way out instead of each inventing its own.
 */

export type ProblemSeverity = 'error' | 'warning' | 'info'

/** Where a problem is, in the terms an editor can jump to. */
export interface ProblemLocation {
  /** Absolute path of the file that carries the problem. */
  path?: string
  /** 1-indexed line. */
  line?: number
}

export interface Problem {
  /** Defaults to `error` — the common case, and the one nothing should downplay. */
  severity?: ProblemSeverity
  /**
   * The addressable thing inside the subject: a dotted field path (`elements.map.type`), a rule id
   * (`ts(2304)`), a setting key. Rendered as code, never as prose.
   */
  field?: string
  /**
   * One human sentence. NOT raw engine output — a daemon's `dial unix /Users/…/docker.sock:
   * connect: no such file or directory` is true, unreadable, and belongs in {@link detail}.
   * Producers classify; this is the classification.
   */
  message: string
  /** What to write instead. Present whenever the fix fits in one sentence. */
  hint?: string
  /**
   * The raw thing the engine, driver or CLI actually said. Shown only where there is room for it —
   * the Event Center — and never on a surface line. An operator needs the exact text; nobody needs
   * it in a strip across their canvas.
   */
  detail?: string
  location?: ProblemLocation
  /**
   * The producer's stable classification (`engine_unavailable`, `auth_failed`). NOT {@link field}:
   * a code there was rendered as a location — `engine_error — Docker returned an error.` — and the
   * title appeared twice in every Event Center body.
   */
  code?: string
  /**
   * The request that failed, when the problem came from one. The Event Center traces THIS request;
   * without it the row guessed "the newest failure in the session", and a Docker problem was filed
   * with a Kubernetes poll's 503 as its cause.
   */
  request?: ProblemRequest
}

/** The failed call a problem came from — what an operator needs to find it in the API log. */
export interface ProblemRequest {
  method?: string
  /** Full path without the query string, e.g. `/rpc/<app>/items`. */
  path?: string
  /** HTTP status, or 0 when the server was never reached. */
  status?: number
  /** The client trace id the transport stamped on the call. */
  traceId?: string
  /** The server's `x-request-id`, which its log lines carry. */
  requestId?: string
}

/**
 * What the person is looking at while the problems stand. This is the difference between an
 * informational strip and an empty pane, so the producer states it instead of the renderer guessing.
 */
export type ProblemConsequence =
  /** The surface still works, showing the last good version. Report quietly, never block. */
  | 'stale'
  /** Nothing rendered. The report IS the surface. */
  | 'blocked'
  /** The surface is fine; these are findings about something else. */
  | 'none'

export interface ProblemSubject {
  /** Short human name — a file name, a server name, a board title. */
  label: string
  /** Absolute path, when the subject is a file that can be opened. */
  path?: string
}

/**
 * One way out of a problem, declared once.
 *
 * Recovery used to be written twice: as markup on the line (`actions={<ProblemAction …>}`) and
 * again as data for the durable row. Half the call sites wrote only the first, so the Event Center
 * row — the copy a person finds an hour later, on a surface they may have closed — was a dead end.
 * Two mini apps independently grew a `durable` flag in their own wrappers to say "this one is
 * surface-only", which is what a missing field looks like from the outside.
 *
 * So it is data, in the shared vocabulary, and both renderers read the same list.
 */
export interface ProblemRecovery {
  /** Stable within one report; keys the row and the surface link. */
  id: string
  label: string
  run: () => void | Promise<void>
  /**
   * Also offered on the durable row. Default true. False for a way out that only means something
   * while looking at the surface — dismissing a line, or destroying the thing that failed.
   */
  durable?: boolean
  /**
   * The one expected next step (Install Docker, Start Docker). A pane draws it as its recommended
   * button; a line and the Event Center row list it first. At most one per report, and never a
   * destructive action.
   */
  primary?: boolean
}

export interface ProblemReport {
  subject: ProblemSubject
  problems: readonly Problem[]
  /** Defaults to `stale`: the conservative reading, and never claims a surface is dead. */
  consequence?: ProblemConsequence
  /** Overrides the computed headline when the producer knows a better sentence. */
  title?: string
}

const RANK: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 }

export const problemSeverity = (problem: Problem): ProblemSeverity => problem.severity ?? 'error'

/** The severity a whole report is judged by — the worst one in it. */
export function worstProblemSeverity(problems: readonly Problem[]): ProblemSeverity {
  let worst: ProblemSeverity = 'info'
  for (const problem of problems) {
    const severity = problemSeverity(problem)
    if (RANK[severity] < RANK[worst]) worst = severity
  }
  return worst
}

/**
 * Worst first, then by line — the order a person reads a file in. Stable for equal keys so the list
 * does not reshuffle when the same report is republished.
 */
export function sortProblems(problems: readonly Problem[]): Problem[] {
  return [...problems]
    .map((problem, index) => ({ problem, index }))
    .sort((left, right) => {
      const bySeverity = RANK[problemSeverity(left.problem)] - RANK[problemSeverity(right.problem)]
      if (bySeverity !== 0) return bySeverity
      const byLine = (left.problem.location?.line ?? 0) - (right.problem.location?.line ?? 0)
      return byLine !== 0 ? byLine : left.index - right.index
    })
    .map((entry) => entry.problem)
}

/** Identity for keying a row and for de-duplicating a republished report. */
export const problemKey = (problem: Problem): string =>
  [
    problemSeverity(problem),
    problem.field ?? '',
    problem.location?.path ?? '',
    problem.location?.line ?? '',
    problem.message,
    // Appended only when present, so every key minted before `code` existed is unchanged.
    ...(problem.code ? [problem.code] : []),
  ].join('|')

/**
 * The headline — the ONE line a surface gets, so it has to be the most useful sentence available.
 *
 * With several problems that is the count: "2 problems in board.json" states the size of the job
 * before anything is expanded, which no single message can. With exactly one it is the message
 * itself, because "1 problem in results" is strictly worse than the sentence it is hiding — and for
 * a driver error or a permission denial that sentence IS the fix. The subject is not repeated in
 * that case: the surface showing the line is already the answer to "where".
 */
export function problemReportTitle(report: ProblemReport): string {
  if (report.title) return headline(report.title)
  const total = report.problems.length
  if (total === 1) return headline(report.problems[0]!.message)
  const noun = worstProblemSeverity(report.problems) === 'error' ? 'problem' : 'note'
  return `${total} ${noun}s in ${report.subject.label}`
}

/** A headline is one line and it fits. Past this a sentence has stopped being a headline. */
const HEADLINE_MAX = 120

/**
 * Make any string safe to put on one line.
 *
 * Defensive on purpose. `message` is contracted to be a human sentence, but a producer that
 * forwards a daemon's raw output anyway must not be able to paint a wall of text across someone's
 * canvas — which is exactly what shipped: `connect to the docker API at unix:///Users/…/docker.sock;
 * check if the path is correct and if the daemon is running: dial unix …: no such file or directory`.
 * The full text is still in the Event Center, which is where it was always readable.
 */
function headline(text: string): string {
  const firstLine = text.split('\n')[0]!.trim()
  if (firstLine.length <= HEADLINE_MAX) return firstLine
  const cut = firstLine.slice(0, HEADLINE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > HEADLINE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * The one line that says what the person is looking at. Empty when there is nothing to add.
 *
 * Only `stale` has anything to add, and that is the whole rule: a surface that still shows its last
 * good version looks healthy, so it has to SAY it is behind. A blocked one is already an empty pane
 * — telling the person "nothing is showing" describes what they are looking at, which is why this
 * deliberately says nothing there rather than narrating the obvious. The renderer used to make that
 * decision itself, which put half of one rule in the vocabulary and half in a component.
 */
export function problemConsequenceLabel(report: ProblemReport): string {
  return (report.consequence ?? 'stale') === 'stale' ? 'showing the last valid version' : ''
}

/**
 * Everything published about one subject, under one namespace.
 *
 * The same expression was written out in three places — the hook's duplicate-owner check, the
 * centre's condition prefix, and the dedupe key below — and all three have to agree or a report
 * settles a row that is not its own. It is one rule, so it is written once: the path when the
 * subject is a file, the label otherwise.
 */
export const problemSubjectKey = (scope: string, subject: ProblemSubject): string =>
  // Each part encoded, because a subject is settled by PREFIX and `:` is the separator: unencoded,
  // clearing subject `logs` also settled `logs:api`, and a scope ending where a path began could
  // claim another scope's rows.
  `${encodeURIComponent(scope)}:${encodeURIComponent(subject.path ?? subject.label)}`

/**
 * A stable key for the durable notification a report becomes. Same subject and same problems mean
 * the same row — republished idempotently, keeping its read state, rather than a new row per save.
 * That is the difference between a notification centre and a log.
 */
export function problemReportDedupeKey(scope: string, report: ProblemReport): string {
  // Sorted by KEY, not by display order: the same set of problems must fingerprint the same way
  // whichever order the producer happened to emit them in this pass.
  const fingerprint = report.problems.map(problemKey).sort().join('~')
  // Prefixed by the subject key, which is what lets settling resolve a whole subject at once.
  return `${problemSubjectKey(scope, report.subject)}:${fingerprint}`
}
