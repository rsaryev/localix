import type { DbErrorCode } from '../../dbClient'
import type { AdaptedResult } from '../resultAdapter'
import {
  appendOutput,
  deriveSqlLabel,
  openOrReuseResult,
  sqlKey,
  tableKey,
  type ResultTabsState,
} from '../resultTabs'
import { isSchemaChangingStatement } from '../../../shared/schema-change'
import type { RunMeta } from './types'

interface RunLogContext {
  at: number
  db: string | undefined
  sql: string
  durationMs: number
}

/**
 * Row result → open (or reuse + refresh) its own tab. Identity: the browsed table when
 * opening a table, else the normalized SQL. Also logs the SELECT to the console, WITHOUT
 * stealing focus from its result tab.
 */
export function recordRowResult(
  s: ResultTabsState,
  ctx: RunLogContext,
  adapted: AdaptedResult,
  meta: RunMeta | undefined,
): ResultTabsState {
  const browse = meta?.browse ?? null
  const asTable = !!(meta?.asTable && browse)
  const key = asTable ? tableKey(browse!.table, browse!.schema) : sqlKey(ctx.sql)
  const label = meta?.label ?? (asTable ? browse!.table : deriveSqlLabel(ctx.sql))
  const rowCount = adapted.rows.length
  const opened = openOrReuseResult(s, {
    key,
    label,
    sql: ctx.sql,
    browse,
    filters: meta?.filters,
    outcome: { result: adapted, durationMs: ctx.durationMs },
  })
  return appendOutput(
    opened,
    {
      ...ctx,
      status: 'ok',
      kind: 'select',
      rowCount,
      message: `${rowCount} row${rowCount === 1 ? '' : 's'} retrieved`,
    },
    false,
  )
}

/**
 * Non-row outcome → append to (and focus) the Output log. DDL reports "completed";
 * everything else reports its affected-row count.
 */
export function recordNonRowResult(
  s: ResultTabsState,
  ctx: RunLogContext,
  rowsAffected: number,
): ResultTabsState {
  const ddl = isSchemaChangingStatement(ctx.sql)
  return appendOutput(s, {
    ...ctx,
    status: 'ok',
    kind: ddl ? 'ddl' : 'affected',
    rowsAffected,
    message: ddl ? 'completed' : `${rowsAffected} row${rowsAffected === 1 ? '' : 's'} affected`,
  })
}

/**
 * Errors are logged too — surface the RAW engine detail (falling back to the friendly
 * message) so the reason ("Duplicate entry …") is visible, not "query failed".
 */
export function recordRunError(
  s: ResultTabsState,
  ctx: RunLogContext,
  message: string,
  detail: string | undefined,
  errorCode: DbErrorCode | null,
): ResultTabsState {
  return appendOutput(s, {
    ...ctx,
    status: 'error',
    kind: 'error',
    message,
    detail,
    errorCode,
  })
}
