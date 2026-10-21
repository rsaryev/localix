import { shellQuote } from '@localixai/plugin-sdk/backend'
/**
 * Hermes adapter — `hermes_sqlite`, `~/.hermes/state.db`.
 *
 * The sixth provider, and the richest store of the six. A real store holds one `sessions` row per
 * session, every one with `source = 'cli'`, and messages of which many carry a tool name.
 *
 * What makes it worth the file is the `sessions` row itself. It already holds `message_count`,
 * `tool_call_count`, `api_call_count`, a `title`, `model`, `parent_session_id`, `started_at`,
 * `ended_at`, and the FULLEST token columns of any provider here — `input_tokens`, `output_tokens`,
 * `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`. So a summary costs ONE indexed
 * query and no message scan at all, where every JSONL provider has to walk a file to count anything.
 *
 * Input EXCLUDES cache: on the largest session here `input_tokens` is 676,662 against
 * `cache_read_tokens` of 2,013,952, so the columns are additive rather than nested. Hence
 * `inputIncludesCached: false`.
 *
 * NO cwd COLUMN EXISTS. A hermes session therefore lands in the statistics' "no working directory
 * recorded" bucket rather than on a project bar, which is a stated limitation and not an omission we
 * can fix by guessing — tool arguments mention absolute paths, but the directory an agent READ is not
 * the directory it RAN in.
 *
 * `sessions` also records `estimated_cost_usd` / `actual_cost_usd`, which no other provider here
 * does. Deliberately not read: `SessionTokenUsage` has no cost field, and adding one for a single
 * provider would put a charged amount beside five providers that report none, which reads as "the
 * others were free". Recorded here so the next reader knows the data exists.
 *
 * The connection is READONLY. This is a live database belonging to another application; the same rule
 * as the opencode adapter, for the same reason. No root override is offered because the binary
 * declares none — checked for a `HERMES_HOME` in its own strings and there is no such variable.
 */

import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  AdapterEnv,
  ProviderAdapter,
  RootProbe,
  SourceRef,
  TranscriptRequest,
  TranscriptResult,
} from './types'
import type { SessionSummary } from '../../shared/contracts'
import { pathExists } from './fs-read'
import { eventWindow } from './event-window'
import { TURN_EVIDENCE_MS, type TurnState } from '../live/turn-state'
import {
  ID,
  msOf,
  summaryOf,
  emitHermesRows,
  type SessionRow,
  type MessageRow,
} from './hermes-rows'

function dbPath(env: AdapterEnv): string {
  return join(env.homeDir || homedir(), '.hermes', 'state.db')
}

/**
 * Readonly, and never created: a missing database is "this provider is not installed".
 *
 * The `immutable=1` fallback exists because a plain readonly open of this file INTERMITTENTLY fails
 * with `SQLITE_CANTOPEN` — observed twice on a real setup, and succeeding on the same path minutes
 * later after another process had touched it. The store is in WAL mode, and a readonly WAL open has
 * to reach a `-shm` sidecar, which is the likeliest place for it to go wrong; that is a hypothesis,
 * not a diagnosis, and it is written here as one. `immutable=1` sidesteps WAL entirely.
 *
 * It is the FALLBACK rather than the default on purpose: immutable promises SQLite that nothing is
 * changing, so it ignores any `-wal` content and can therefore read a snapshot missing the newest
 * committed messages. Correct-but-sometimes-unavailable is tried first; readable-but-possibly-behind
 * second. A caller that gets neither sees an empty provider, never a crash.
 */
function open(env: AdapterEnv): Database | undefined {
  const path = dbPath(env)
  try {
    return new Database(path, { readonly: true })
  } catch {
    try {
      return new Database(`file:${path}?immutable=1`, { readonly: true })
    } catch {
      return undefined
    }
  }
}

async function probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]> {
  const path = dbPath(env)
  return [{ path, exists: await pathExists(path) }]
}

/**
 * One indexed query. The revision has to change whenever the session's content does, and both
 * `ended_at` and `message_count` move as a session grows — a live session has `ended_at` NULL, so
 * the count is what keeps it invalidating.
 */
async function listSources(env: AdapterEnv): Promise<readonly SourceRef[]> {
  const db = open(env)
  if (!db) return []
  try {
    const rows = db
      .query<
        Pick<SessionRow, 'id' | 'started_at' | 'ended_at' | 'message_count' | 'parent_session_id'>,
        []
      >(
        `SELECT id, started_at, ended_at, message_count, parent_session_id
           FROM sessions ORDER BY started_at DESC`,
      )
      .all()
    return rows.map((row) => ({
      nativeSessionId: row.id,
      sourcePath: dbPath(env),
      revision: `${row.ended_at ?? row.started_at ?? 0}|${row.message_count ?? 0}`,
      updatedAtHint: msOf(row.ended_at) ?? msOf(row.started_at),
      ...(row.parent_session_id ? { parentHint: row.parent_session_id } : {}),
    }))
  } finally {
    db.close()
  }
}

async function readSummaries(
  refs: readonly SourceRef[],
  env: AdapterEnv,
): Promise<readonly SessionSummary[]> {
  if (refs.length === 0) return []
  const db = open(env)
  if (!db) return []
  const path = dbPath(env)
  try {
    const out: SessionSummary[] = []
    const statement = db.query<SessionRow, [string]>(
      `SELECT id, title, model, parent_session_id, started_at, ended_at, message_count,
              api_call_count, input_tokens, output_tokens, cache_read_tokens,
              cache_write_tokens, reasoning_tokens
         FROM sessions WHERE id = ?`,
    )
    for (const ref of refs) {
      const row = statement.get(ref.nativeSessionId)
      if (row) out.push(summaryOf(row, path))
    }
    return out
  } finally {
    db.close()
  }
}

async function readTranscript(req: TranscriptRequest, env: AdapterEnv): Promise<TranscriptResult> {
  const db = open(env)
  if (!db) return { events: [], total: 0 }
  const window = eventWindow(req.maxEvents, req.tail, req.from)
  const base = { provider: ID, nativeSessionId: req.ref.nativeSessionId } as const
  try {
    // `id` is AUTOINCREMENT, so it IS the append order — the one ordering we can defend.
    const rows = db
      .query<MessageRow, [string]>(
        `SELECT role, content, tool_call_id, tool_calls, tool_name, timestamp
           FROM messages WHERE session_id = ? ORDER BY id ASC`,
      )
      .all(req.ref.nativeSessionId)
    emitHermesRows(rows, base, req, window)
    return window.result()
  } finally {
    db.close()
  }
}

/**
 * See `ProviderAdapter.readTurnState`. Hermes keeps no append-only log, but it does not need one: it
 * WRITES DOWN that a session ended.
 *
 * In a Hermes store most sessions carry `ended_at`, with an `end_reason` such as `cli_close` or
 * `new_session`, and one that does not may have been abandoned long ago. So an ended session is
 * idle outright, and for the open one the last message's role is the same question the appending
 * formats answer — a `user` or `tool` row is the model being called, an `assistant` row is the turn
 * handed back.
 */
async function readTurnState(
  ref: SourceRef,
  env: AdapterEnv,
  now: number,
): Promise<TurnState | undefined> {
  const db = open(env)
  if (!db) return undefined
  try {
    const session = db
      .query('SELECT ended_at FROM sessions WHERE id = ?')
      .get(ref.nativeSessionId) as { ended_at: number | null } | null
    if (!session) return undefined
    if (session.ended_at !== null) return 'idle'
    const last = db
      .query(
        'SELECT role, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1',
      )
      .get(ref.nativeSessionId) as { role: string; timestamp: number } | null
    if (!last) return undefined
    const state: TurnState = last.role === 'assistant' ? 'idle' : 'working'
    // Seconds here, milliseconds everywhere else — and the same rule: a mid-turn reading expires,
    // a finished one does not.
    return state === 'working' && now - last.timestamp * 1000 > TURN_EVIDENCE_MS ? undefined : state
  } catch {
    return undefined
  } finally {
    db.close()
  }
}

export const hermesAdapter: ProviderAdapter = {
  id: ID,
  command: 'hermes',
  displayName: 'Hermes',
  sourceFormat: 'hermes_sqlite',
  verified: true,
  detectionManifestId: ID,
  probeRoots,
  listSources,
  readSummaries,
  readTranscript,
  readTurnState,
  resumeCommand: (id) => `hermes --resume ${shellQuote(id)}`,
}
