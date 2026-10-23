/**
 * Dialect-agnostic error mapping. Every driver throws its own engine-specific error
 * shape; a running console needs a small, stable, typed vocabulary the UI can render
 * cleanly (and branch on) WITHOUT knowing anything about postgres vs mysql vs mssql.
 *
 * The rule: no `dialect` branching leaks into the service or routes — each raw driver
 * error is fed through `mapDbError`, which pattern-matches on the common substrings and
 * numeric/string error codes the SQL engines share, and collapses them into a
 * {@link DbErrorCode}. `timeout` and `cancelled` are produced by the service's query
 * lifecycle directly; the rest are recognised here from the raw error.
 *
 * The typed-error SKELETON (the error class, `toErrorInfo`) is the shared
 * `defineTypedError` kit — four workbenches had hand-rolled it identically. What stays
 * here is the only part with domain content in it: the FRIENDLY sentences and
 * {@link mapDbError}'s SQLSTATE/errno/substring classification.
 *
 * NOTE: `mapDbError` deliberately does NOT use `kit.rawOf`. It passes its raw text to
 * the constructor UNCONDITIONALLY (no `|| undefined`), so it needs `String(err)`
 * semantics — `kit.rawOf(null)` is `''`, which is not nullish and would therefore become
 * an EMPTY `message` instead of falling back to the friendly sentence.
 */

import { defineTypedError, type TypedDomainError } from '@localixai/mini-app-sdk/backend'

export type DbErrorCode =
  | 'timeout'
  | 'cancelled'
  | 'auth_failed'
  | 'host_unreachable'
  | 'tls_failed'
  | 'syntax_error'
  | 'query_failed'
  | 'readonly_blocked'
  | 'tx_unsupported'
  /** Bound parameters arrived with a multi-statement text; which statement owns which
   *  value cannot be decided without guessing, so the run is refused before any executes. */
  | 'script_params'
  | 'ssh_failed'
  /** The connection id is unknown or its driver is no longer connected. */
  | 'connection_not_found'
  /** The REQUEST was malformed — not an engine failure. Produced by the route validator. */
  | 'invalid_request'

/** Human-readable one-liners, keyed by code, for the UI to show as-is. */
const FRIENDLY: Record<DbErrorCode, string> = {
  timeout: 'The query took too long and was cancelled.',
  cancelled: 'The query was cancelled.',
  auth_failed: 'Authentication failed — check the username and password.',
  host_unreachable:
    'Could not reach the database host — check the address and that the server is running.',
  tls_failed:
    "TLS/SSL handshake failed — the server's certificate isn't trusted. For a self-signed cert, turn off certificate verification (SSL → trust the server certificate) or supply the CA.",
  syntax_error: 'The SQL could not be parsed — there is a syntax error.',
  query_failed: 'The query failed.',
  readonly_blocked: 'Connection is read-only — write statements are blocked.',
  tx_unsupported: 'This engine does not support transactions.',
  script_params:
    'Parameters can only be bound to a single statement — run the statements one at a time.',
  ssh_failed:
    'Could not establish the SSH tunnel — check the SSH host, port, user, and credentials.',
  invalid_request: 'The request was not valid.',
  connection_not_found:
    'That database connection is no longer available — reconnect it in the Database workbench, then try again.',
}

const kit = defineTypedError<DbErrorCode>('DbError', FRIENDLY)

/**
 * A typed database error. `code` is the stable, agnostic classification; `message`
 * carries the raw engine text so the operator still sees exactly what the engine said,
 * while `friendly` is a clean sentence keyed off `code`. `cause` keeps the original.
 */
export const DbError = kit.DomainError
export type DbError = TypedDomainError<DbErrorCode>

export const toErrorInfo = kit.toErrorInfo

/**
 * Where a multi-statement run stopped. Without it, a script whose third statement failed
 * reported only the engine's text, and the user could not tell that the first two had
 * already been applied (each statement auto-commits outside a manual transaction).
 */
export interface DbStatementFailure {
  /** 0-based index of the failing statement. */
  index: number
  total: number
  /** Statements that completed before the failure (always `index`). */
  executed: number
  /** Offset of the failing statement's first character in the submitted text. */
  start: number
}

const statementFailures = new WeakMap<DbError, DbStatementFailure>()

/** A copy of `err` that remembers which statement of a script failed. */
export function withStatementFailure(err: DbError, failure: DbStatementFailure): DbError {
  const copy = new DbError(err.code, err.message, { cause: err.cause ?? err })
  statementFailures.set(copy, failure)
  return copy
}

export function statementFailureOf(err: unknown): DbStatementFailure | undefined {
  return err instanceof DbError ? statementFailures.get(err) : undefined
}

/** Best-effort string + numeric code extraction from an arbitrary thrown value. */
function codeStrings(err: unknown): { text: string; codes: string[] } {
  const codes: string[] = []
  let text = ''
  if (err instanceof Error) text = err.message
  else if (typeof err === 'string') text = err
  else text = String(err)
  const anyErr = err as {
    code?: unknown
    errno?: unknown
    number?: unknown
    sqlState?: unknown
  } | null
  for (const v of [anyErr?.code, anyErr?.errno, anyErr?.number, anyErr?.sqlState]) {
    if (typeof v === 'string') codes.push(v)
    else if (typeof v === 'number' || typeof v === 'bigint') codes.push(String(v))
  }
  return { text: text.toLowerCase(), codes }
}

/**
 * Classify a raw driver error into a {@link DbError}. Idempotent: an already-mapped
 * {@link DbError} is returned unchanged so callers can map defensively.
 */
export function mapDbError(err: unknown): DbError {
  if (err instanceof DbError) return err
  const { text, codes } = codeStrings(err)
  const has = (...needles: string[]) => needles.some((n) => text.includes(n))
  const codeIs = (...cs: string[]) => cs.some((c) => codes.includes(c))
  const raw = err instanceof Error ? err.message : String(err)

  // Cancelled — pg 57014, mssql ECANCEL, mysql ER_QUERY_INTERRUPTED (1317).
  if (
    codeIs('57014', 'ECANCEL', '1317', 'ER_QUERY_INTERRUPTED') ||
    has('cancel', 'query execution was interrupted', 'aborterror')
  )
    return new DbError('cancelled', raw, { cause: err })

  // Timeout — connect/statement timeouts across engines. pg/mysql surface the Node socket
  // code ETIMEDOUT; mssql (tedious) uses its own ETIMEOUT ("...to connect ... in <n>ms").
  // NOTE: mssql's ESOCKET is a GENERIC socket-establishment failure (connection refused, a
  // TLS/servername error, a dropped socket) — NOT a timeout. Classifying it here would
  // mislabel an unreachable host or a cert failure as "timeout", so ESOCKET is intentionally
  // left to the message-based host_unreachable / tls_failed branches below (and query_failed
  // as a last resort).
  if (codeIs('ETIMEDOUT', 'ETIMEOUT') || has('timeout', 'timed out', 'etimedout'))
    return new DbError('timeout', raw, { cause: err })

  // TLS/SSL handshake — a self-signed / untrusted / expired server cert, or an SNI mismatch
  // (incl. mssql's "servername to an IP" restriction). Matched on cert-SPECIFIC codes/phrases
  // (never bare "ssl"/"tls", too broad) and placed before auth/host so a cert failure is never
  // mistaken for bad credentials. mysql2 wraps these as HANDSHAKE_SSL_ERROR.
  if (
    codeIs(
      'HANDSHAKE_SSL_ERROR',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
    ) ||
    has(
      'self signed certificate',
      'self-signed certificate',
      'unable to verify the first certificate',
      'unable to get local issuer certificate',
      'certificate has expired',
      'servername to an ip',
    )
  )
    return new DbError('tls_failed', raw, { cause: err })

  // Auth — pg 28P01/28000, mysql ER_ACCESS_DENIED_ERROR (1045), mssql ELOGIN / login failed.
  if (
    codeIs('28P01', '28000', '1045', 'ER_ACCESS_DENIED_ERROR', 'ELOGIN') ||
    has('password authentication failed', 'authentication failed', 'access denied', 'login failed')
  )
    return new DbError('auth_failed', raw, { cause: err })

  // Host unreachable — TCP/DNS level failures.
  if (
    codeIs('ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN') ||
    has(
      'econnrefused',
      'enotfound',
      'getaddrinfo',
      'connection refused',
      'could not connect',
      'connection terminated',
    )
  )
    return new DbError('host_unreachable', raw, { cause: err })

  // Syntax — pg 42601, mysql ER_PARSE_ERROR (1064), mssql "Incorrect syntax".
  if (
    codeIs('42601', '1064', 'ER_PARSE_ERROR') ||
    has('syntax error', 'incorrect syntax', 'parse error')
  )
    return new DbError('syntax_error', raw, { cause: err })

  return new DbError('query_failed', raw, { cause: err })
}
