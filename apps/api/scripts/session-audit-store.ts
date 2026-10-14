import type { Database } from 'bun:sqlite'

export interface AuditSession {
  id: string
  parent_session_id: string | null
  title: string
  runtime_status: string
}

/** Strict parsing prevents an option's value being mistaken for the session id. */
export function parseSessionArgs(args: readonly string[], valueFlags: readonly string[]) {
  let sessionId: string | undefined
  const values: Record<string, string> = {}
  let tree = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--tree') {
      tree = true
    } else if (arg.startsWith('--')) {
      const name = arg.slice(2)
      const value = args[++i]
      if (!valueFlags.includes(name) || !value || value.startsWith('--')) {
        throw new Error(`Unknown option or missing value: ${arg}`)
      }
      values[name] = value
    } else if (sessionId) {
      throw new Error(`Unexpected argument: ${arg}`)
    } else {
      sessionId = arg
    }
  }
  if (!sessionId) throw new Error('A session id is required.')
  return { sessionId, values, tree }
}

/** UNION deduplicates ids, so corrupt ancestry cannot recurse indefinitely. */
export function readAuditSessions(db: Database, sessionId: string, tree: boolean): AuditSession[] {
  const sessions = db
    .query(
      tree
        ? `WITH RECURSIVE subtree(id) AS (
            SELECT id FROM agent_sessions WHERE id = ?
            UNION
            SELECT s.id FROM agent_sessions s JOIN subtree p ON s.parent_session_id = p.id
          ) SELECT id, parent_session_id, title, runtime_status FROM agent_sessions
          WHERE id IN (SELECT id FROM subtree) ORDER BY created_at, id`
        : 'SELECT id, parent_session_id, title, runtime_status FROM agent_sessions WHERE id = ?',
    )
    .all(sessionId) as AuditSession[]
  if (!sessions.length) throw new Error(`Session not found: ${sessionId}`)
  return sessions
}

export interface AuditUsage {
  rows: number
  input: number
  cached: number
  output: number
  cost: number
  unpriced: number
  auxiliary: number
  sources: string[]
}

/** The usage ledger includes auxiliary calls absent from the transcript (completion, etc.). */
export function readAuditUsage(db: Database, sessionIds: readonly string[]): AuditUsage {
  const totals: AuditUsage = {
    rows: 0,
    input: 0,
    cached: 0,
    output: 0,
    cost: 0,
    unpriced: 0,
    auxiliary: 0,
    sources: [],
  }
  const sources = new Set<string>()
  for (const sessionId of new Set(sessionIds)) {
    const rows = db
      .query(
        `SELECT u.input_tokens, u.cache_read_tokens, u.output_tokens, u.cost_usd, u.cost_source,
        m.id AS transcript_id FROM usage_events u
        LEFT JOIN agent_messages m ON m.id = u.message_id WHERE u.session_id = ?`,
      )
      .all(sessionId) as Array<{
      input_tokens: number
      cache_read_tokens: number
      output_tokens: number
      cost_usd: number | null
      cost_source: string | null
      transcript_id: string | null
    }>
    for (const row of rows) {
      totals.rows += 1
      totals.input += row.input_tokens
      totals.cached += row.cache_read_tokens
      totals.output += row.output_tokens
      if (row.cost_usd === null) totals.unpriced += 1
      else totals.cost += row.cost_usd
      if (row.transcript_id === null) totals.auxiliary += 1
      sources.add(row.cost_source ?? 'unknown')
    }
  }
  totals.sources = [...sources].sort()
  return totals
}
