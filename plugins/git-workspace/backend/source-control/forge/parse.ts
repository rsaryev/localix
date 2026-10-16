/**
 * Pure `gh --json` → contract mapping. No process, no I/O — just data shaping, so
 * it's exhaustively unit-testable against the stable gh JSON shapes. The gh wire
 * format lives ONLY here + the backend impl; nothing downstream sees it.
 */
import type { ForgeCheckRollup, ForgePrState, ForgePullRequest } from './contracts'

/** One entry of gh's `statusCheckRollup` array (CheckRun or StatusContext). */
interface RawCheck {
  __typename?: string
  /** CheckRun lifecycle: QUEUED | IN_PROGRESS | COMPLETED | … */
  status?: string
  /** CheckRun result once COMPLETED: SUCCESS | FAILURE | NEUTRAL | SKIPPED | … */
  conclusion?: string
  /** StatusContext (legacy commit status): SUCCESS | PENDING | FAILURE | ERROR | EXPECTED */
  state?: string
}

/** A single gh pull-request record (only the fields we request). */
interface RawPr {
  number?: number
  title?: string
  state?: string
  headRefName?: string
  url?: string
  isDraft?: boolean
  author?: { login?: string } | null
  statusCheckRollup?: RawCheck[] | null
}

const FAIL_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'STARTUP_FAILURE',
  'ACTION_REQUIRED',
  'STALE',
])
const FAIL_STATES = new Set(['FAILURE', 'ERROR'])

/** Classify one check as pass / fail / pending. */
function classifyCheck(check: RawCheck): 'pass' | 'fail' | 'pending' {
  // Legacy StatusContext carries `state`; a modern CheckRun carries status/conclusion.
  if (check.state) {
    const s = check.state.toUpperCase()
    if (s === 'SUCCESS') return 'pass'
    if (FAIL_STATES.has(s)) return 'fail'
    return 'pending' // PENDING / EXPECTED / anything unknown → not settled
  }
  const status = (check.status ?? '').toUpperCase()
  if (status && status !== 'COMPLETED') return 'pending'
  const conclusion = (check.conclusion ?? '').toUpperCase()
  if (FAIL_CONCLUSIONS.has(conclusion)) return 'fail'
  // SUCCESS / NEUTRAL / SKIPPED (and a completed-with-empty-conclusion) → pass.
  return 'pass'
}

/**
 * Roll every check up to one verdict (matches gh's own precedence): any failure
 * dominates, then any still-pending, else all passing; an empty/absent rollup is
 * `none` (no CI configured or not reported).
 */
export function rollupChecks(checks: RawCheck[] | null | undefined): ForgeCheckRollup {
  if (!checks || checks.length === 0) return 'none'
  let pending = false
  for (const c of checks) {
    const verdict = classifyCheck(c)
    if (verdict === 'fail') return 'failing'
    if (verdict === 'pending') pending = true
  }
  return pending ? 'pending' : 'passing'
}

/** Normalize gh's state string to our closed union (defaults to OPEN). */
function normalizeState(state: string | undefined): ForgePrState {
  const s = (state ?? '').toUpperCase()
  if (s === 'MERGED') return 'MERGED'
  if (s === 'CLOSED') return 'CLOSED'
  return 'OPEN'
}

/** Map one raw gh PR record to the contract (drops records with no usable number). */
export function parsePullRequest(raw: RawPr): ForgePullRequest | null {
  if (typeof raw.number !== 'number') return null
  return {
    number: raw.number,
    title: raw.title ?? '',
    state: normalizeState(raw.state),
    headRefName: raw.headRefName ?? '',
    url: raw.url ?? '',
    isDraft: raw.isDraft === true,
    author: raw.author?.login ?? null,
    checks: rollupChecks(raw.statusCheckRollup),
  }
}

/** Parse the whole `gh pr list --json …` payload; tolerant of a non-array / junk. */
export function parsePullRequests(json: string): ForgePullRequest[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: ForgePullRequest[] = []
  for (const item of data) {
    const pr = parsePullRequest(item as RawPr)
    if (pr) out.push(pr)
  }
  return out
}

/** Extract `owner/repo` from `gh repo view --json nameWithOwner`; null on junk. */
export function parseNameWithOwner(json: string): string | null {
  try {
    const data = JSON.parse(json) as { nameWithOwner?: unknown }
    return typeof data.nameWithOwner === 'string' ? data.nameWithOwner : null
  } catch {
    return null
  }
}
