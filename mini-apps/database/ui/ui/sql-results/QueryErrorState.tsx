import type { ReactNode } from 'react'
import { Ban } from 'lucide-react'
import { ProblemState } from '@localixai/mini-app-sdk/ui/components'
import type { DbErrorCode } from '../../dbClient'
import { useDbProblem } from '../../problems'

/** Short human title per typed error code (falls back to the raw message alone). */
const ERROR_TITLE: Partial<Record<DbErrorCode, string>> = {
  timeout: 'Query timed out',
  cancelled: 'Query stopped',
  auth_failed: 'Authentication failed',
  host_unreachable: 'Host unreachable',
  tls_failed: 'TLS/SSL error',
  syntax_error: 'Syntax error',
  query_failed: 'Query failed',
  // Not a query failure: the connection went away, so the title must not blame the SQL.
  connection_not_found: 'Connection unavailable',
}

/** Past this a driver's line has stopped being a headline — the same bound the host clamps at. */
const HEADLINE_MAX = 120

/**
 * Engine-error empty state. A user-initiated stop is not a failure at all, so it never becomes a
 * report — it is a muted note and nothing else.
 *
 * A hook, so the results pane can own the report ABOVE its `if (error)` branch: the branch is gone
 * the moment the next query succeeds, and a publisher that lives inside it can never say so. Pass
 * `error: null` while the pane is healthy and the Event Center row settles itself.
 *
 * `subject` is the console this result belongs to, and it must NAME it — settling resolves every
 * row for one subject, so while every SQL console reported under "Query failed" two consoles
 * failing at once settled each other, and the survivor's row said nothing about which database it
 * came from. The classified title below stays on the surface; it is not an identity.
 */
export function useQueryErrorState({
  subject,
  error,
  errorCode,
  errorDetail,
}: {
  /** The console a person would recognise: the connection, plus the table or file when there is one. */
  subject: string
  error: string | null
  errorCode?: DbErrorCode | null
  errorDetail?: string | null
}): ReactNode | null {
  const cancelled = errorCode === 'cancelled'
  const title =
    (errorCode && ERROR_TITLE[errorCode]) ?? (cancelled ? 'Query stopped' : 'Query failed')
  const detail = errorDetail?.trim() || undefined
  // The engine's own line is the headline WHILE IT IS ONE — a constraint name or a syntax position
  // is what a person acts on. A driver that answers with a paragraph is not a headline, so there
  // the classified sentence takes the line and the engine keeps its exact words in the report.
  const engineLine = detail && !detail.includes('\n') && detail.length <= HEADLINE_MAX
  const problem = useDbProblem(subject, cancelled || !error ? null : engineLine ? detail : error, {
    detail,
  })
  if (!error) return null
  if (problem) return <ProblemState {...problem} />
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Ban className="size-6 text-text-faint" />
        <div className="text-sm font-medium text-foreground">{title}</div>
      </div>
    </div>
  )
}
