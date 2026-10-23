/**
 * opencode adapter — `opencode_sqlite`.
 *
 * Root precedence is `$OPENCODE_DB`, then
 * `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db`.
 *
 * WHY THE DATABASE AND NOT THE JSON TREE: this install ALSO has a
 * `~/.local/share/opencode/storage/{session,message,part}/**.json` tree — 42,238 files. Both
 * describe the same 174 sessions. Enumerating the roster from the JSON tree would mean tens of
 * thousands of `stat` calls per scan; the database answers the same question with one indexed
 * query.
 *
 * The connection is opened READONLY. This is a live database belonging to another running
 * application, and opening it read-write risks taking a write lock. Provider-owned files must
 * remain read-only.
 *
 * VERIFIED against real data: 174 sessions in ~/.local/share/opencode/opencode.db.
 */

import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { shellQuote } from '@localixai/mini-app-sdk/backend'
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
import { TURN_EVIDENCE_MS, type TurnState } from '../live/turn-state'
import { asRecord, asString } from './json-util'

import {
  ID,
  summarizeOpencodeRows,
  transcriptFromOpencodeRows,
  type SessionRow,
  type UsageRow,
  type MessageRow,
} from './opencode-rows'

function dbPath(env: AdapterEnv): string {
  const explicit = env.env.OPENCODE_DB?.trim()
  if (explicit) return explicit
  const dataHome =
    env.env.XDG_DATA_HOME?.trim() || join(env.homeDir || homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'opencode.db')
}

/**
 * `:memory:` means the user configured opencode with no disk history at all. Probing it as a path
 * would produce a phantom root.
 */
function isDiskPath(path: string): boolean {
  return path !== ':memory:' && !path.startsWith('file::memory:')
}

function openReadonly(path: string): Database {
  return new Database(path, { readonly: true })
}

interface MessageCountRow {
  session_id: string
  messages: number
}

async function listSources(env: AdapterEnv): Promise<readonly SourceRef[]> {
  const path = dbPath(env)
  if (!isDiskPath(path) || !(await pathExists(path))) return []
  const db = openReadonly(path)
  try {
    const rows = db
      .query<SessionRow, []>(
        'select id, parent_id, directory, title, time_created, time_updated from session',
      )
      .all()
    return rows.map((row) => ({
      nativeSessionId: row.id,
      sourcePath: path,
      // The row's own updated stamp: changes exactly when the session changes, which is what the
      // index cache needs. The database file's mtime would invalidate every session on any write.
      revision: String(row.time_updated),
      cwdHint: row.directory,
      updatedAtHint: row.time_updated,
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
  const path = dbPath(env)
  if (!isDiskPath(path) || !(await pathExists(path))) return []
  const db = openReadonly(path)
  try {
    const wanted = new Set(refs.map((r) => r.nativeSessionId))
    const rows = db
      .query<SessionRow, []>(
        'select id, parent_id, directory, title, time_created, time_updated from session',
      )
      .all()
    // opencode names a session lazily: until it has a reason to, the title stays its own
    // placeholder (`New session - <ISO>`). A list of those is a list of timestamps, so the first
    // thing the user actually typed is read for exactly those rows — one bounded query, and only
    // for the sessions that need it.
    const firstPrompt = db.query<{ data: string }, [string]>(
      `select p.data from part p
         join message m on m.id = p.message_id
        where p.session_id = ? and json_extract(m.data, '$.role') = 'user'
        order by p.time_created, p.id
        limit 8`,
    )
    // Only the sessions asked for: a live session changes every message, and aggregating the whole
    // table for its one row cost as much as summarizing every session (59 ms of 89 on a 107 MB db).
    const ids = JSON.stringify([...wanted])
    const messageCounts = new Map(
      db
        .query<MessageCountRow, [string]>(
          `select session_id, count(*) as messages
             from message
            where session_id in (select value from json_each(?))
              and json_extract(data, '$.role') in ('user', 'assistant')
            group by session_id`,
        )
        .all(ids)
        .map((row) => [row.session_id, row.messages]),
    )
    const usageRows = db
      .query<UsageRow, [string]>(
        `select session_id,
                strftime('%Y-%m-%d', time_created / 1000, 'unixepoch') as day,
                json_extract(data, '$.modelID') as model,
                count(*) as requests,
                sum(coalesce(json_extract(data, '$.tokens.input'), 0)) as input_tokens,
                sum(coalesce(json_extract(data, '$.tokens.cache.read'), 0)) as cached_input_tokens,
                sum(coalesce(json_extract(data, '$.tokens.cache.write'), 0)) as cache_write_tokens,
                sum(coalesce(json_extract(data, '$.tokens.output'), 0)) as output_tokens,
                sum(coalesce(json_extract(data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
                sum(coalesce(json_extract(data, '$.tokens.total'), 0)) as total_tokens
           from message
          where session_id in (select value from json_each(?))
            and json_extract(data, '$.role') = 'assistant'
            and json_type(data, '$.tokens') is not null
          group by session_id, day, model`,
      )
      .all(ids)
    return summarizeOpencodeRows(rows, wanted, usageRows, messageCounts, firstPrompt, path)
  } finally {
    db.close()
  }
}

async function readTranscript(req: TranscriptRequest, env: AdapterEnv): Promise<TranscriptResult> {
  const path = dbPath(env)
  if (!isDiskPath(path) || !(await pathExists(path))) return { events: [], total: 0 }
  const db = openReadonly(path)
  try {
    const messages = db
      .query<MessageRow, [string]>(
        'select id, time_created, data from message where session_id = ? order by time_created, id',
      )
      .all(req.ref.nativeSessionId)
    const partsFor = db.query<{ message_id: string; data: string }, [string]>(
      'select message_id, data from part where session_id = ? order by message_id, id',
    )
    // One event per PART, not one per message.
    //
    // A message's parts are its turn broken into what actually happened: prose, reasoning, and the
    // tool calls between them. The previous reader joined every part's `.text` into a single blob,
    // which dropped the tool parts entirely — they carry no `.text`, only `tool`, `callID` and a
    // `state` holding the input and the output. In a working session those are a large share of all
    // parts, and all of the work.
    const parts = partsFor.all(req.ref.nativeSessionId)
    return transcriptFromOpencodeRows(messages, parts, req)
  } finally {
    db.close()
  }
}

/**
 * See `ProviderAdapter.readTurnState`. opencode keeps no append-only log — its history is a
 * database, one row per message — so the answer is the NEWEST message row rather than a file's last
 * bytes.
 *
 * Taking the newest message of each session gives either `assistant` with `time.completed` set or
 * `assistant` still open. A completed assistant message is the turn handed back; an open one is a
 * model mid-stream, and a `user` row is a model about to be called.
 *
 * NOT read from the JSON tree beside the database, even though the same messages are there: the
 * newest file by name is often not the newest by mtime, so answering from it would mean stat-ing
 * every message file of a session to sort them.
 */
async function readTurnState(
  ref: SourceRef,
  env: AdapterEnv,
  now: number,
): Promise<TurnState | undefined> {
  const path = dbPath(env)
  if (!isDiskPath(path)) return undefined
  let db: Database | undefined
  try {
    db = openReadonly(path)
    const row = db
      .query(
        'SELECT time_created, data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 1',
      )
      .get(ref.nativeSessionId) as { time_created: number; data: string } | null
    if (!row) return undefined
    const message = asRecord(JSON.parse(row.data))
    const role = asString(message?.role)
    const completed = asRecord(message?.time)?.completed
    if (role === 'assistant' && typeof completed === 'number') return 'idle'
    if (role !== 'assistant' && role !== 'user') return undefined
    // Mid-stream or awaiting the model: evidence only while it is fresh, same as every other format.
    return now - row.time_created > TURN_EVIDENCE_MS ? undefined : 'working'
  } catch {
    return undefined
  } finally {
    db?.close()
  }
}

export const opencodeAdapter: ProviderAdapter = {
  id: ID,
  command: 'opencode',
  displayName: 'opencode',
  sourceFormat: 'opencode_sqlite',
  verified: true,
  detectionManifestId: 'opencode',
  resumeCommand: (id) => `opencode --session ${shellQuote(id)}`,
  async probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]> {
    const path = dbPath(env)
    return [{ path, exists: isDiskPath(path) && (await pathExists(path)) }]
  },
  listSources,
  readSummaries,
  readTranscript,
  readTurnState,
}
