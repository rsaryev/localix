import { CircleAlert, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { SqlProblemSummary } from '../sqlDiagnostics'

/**
 * The run bar's verdict on the text BEFORE it is run: how many problems the live name checks, the
 * engine's compile check and the last failure found, and the first one's reason — clickable, to
 * put the caret on it.
 *
 * It exists because a squiggle alone was not an answer: a thin underline under one word, in a
 * buffer that (until recently) underlined every table name, did not tell the user that the query
 * would fail. One line in the bar they look at before pressing Run does.
 */
export function ProblemStatus({
  problems,
  onReveal,
}: {
  problems: SqlProblemSummary
  onReveal?: () => void
}) {
  const count = problems.errors + problems.warnings
  if (count === 0) {
    if (!problems.checking) return null
    return (
      <span className="flex items-center gap-1 text-text-faint" role="status">
        <LoaderCircle className="size-3 animate-spin" aria-hidden />
        Checking…
      </span>
    )
  }
  const error = problems.errors > 0
  const Icon = error ? CircleAlert : TriangleAlert
  const label = `${count} ${count === 1 ? 'problem' : 'problems'}`
  return (
    <button
      type="button"
      onClick={onReveal}
      title={problems.first ? `Line ${problems.first.line}: ${problems.first.message}` : label}
      className={`flex min-w-0 items-center gap-1 rounded-xs outline-none focus-ring hover:underline ${error ? 'text-status-error' : 'text-status-warning'}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="shrink-0 font-medium">{label}</span>
      {problems.first && (
        <span className="min-w-0 truncate text-text-soft">
          — line {problems.first.line}: {problems.first.message}
        </span>
      )}
    </button>
  )
}
