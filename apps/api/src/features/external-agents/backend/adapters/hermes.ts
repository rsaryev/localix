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
import type { SessionSummary, TranscriptEvent } from '../../shared/contracts'
import { clip, pathExists } from './fs-read'
import { firstText } from './json-util'
import { eventWindow } from './event-window'
import { linkKeyOf } from '../../shared/identity'
import { TURN_EVIDENCE_MS, type TurnState } from '../live/turn-state'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'

const ID = 'hermes'
/**
 * The same bound the other four adapters pass to `firstText`. A title is a NAME: it flattens to one
 * line and ends in a single ellipsis, where `clip` — which this used — is for event BODIES and appends
 * a `\n[... N more characters]` marker, producing a 146-character "title" with a newline inside it.
 */
const TITLE_CHARS = 120

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

interface SessionRow {
  id: string
  title: string | null
  model: string | null
  parent_session_id: string | null
  started_at: number | null
  ended_at: number | null
  message_count: number | null
  api_call_count: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  reasoning_tokens: number | null
}

/** Hermes stores unix SECONDS as REAL; every timestamp we hold is integer ms. */
function msOf(seconds: number | null | undefined): number | undefined {
  return seconds ? Math.round(seconds * 1000) : undefined
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

function summaryOf(row: SessionRow, path: string): SessionSummary {
  const usage = new SessionUsageAccumulator()
  const startedAt = msOf(row.started_at)
  usage.add(
    normalizeTokenSample(
      {
        inputTokens: row.input_tokens ?? 0,
        cachedInputTokens: row.cache_read_tokens ?? 0,
        cacheWriteTokens: row.cache_write_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        // Additive columns, measured — see the header.
        inputIncludesCached: false,
      },
      // Requests as the provider counted them, not one per session.
      Math.max(0, row.api_call_count ?? 0),
    ),
    row.model ?? undefined,
    startedAt,
  )
  const measured = usage.result()
  const title = row.title?.trim()
  return {
    key: linkKeyOf({ provider: ID, nativeSessionId: row.id }),
    provider: ID,
    nativeSessionId: row.id,
    // 13 of a real history's 19 sessions have a title; the id is the honest fallback for the rest.
    title: firstText(title, TITLE_CHARS) ?? row.id,
    ...(startedAt ? { startedAt } : {}),
    ...(row.model ? { model: row.model } : {}),
    updatedAt: msOf(row.ended_at) ?? startedAt ?? Date.now(),
    ...(row.message_count ? { messageCount: row.message_count } : {}),
    ...(measured ? { usage: measured } : {}),
    sourcePath: path,
    ...(row.parent_session_id ? { parentNativeSessionId: row.parent_session_id } : {}),
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

interface MessageRow {
  role: string
  content: string | null
  tool_call_id: string | null
  tool_calls: string | null
  tool_name: string | null
  timestamp: number | null
}

/** A tool result's payload. Hermes wraps it as `{"content": "…"}`; anything else is kept verbatim. */
function resultText(content: string | null): string {
  if (!content) return ''
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const inner = (parsed as { content?: unknown }).content
      if (typeof inner === 'string') return inner
    }
  } catch {
    // Not JSON. The raw text is what the provider recorded.
  }
  return content
}

/** OpenAI-shaped: `[{ call_id, function: { name, arguments } }]`, arguments a JSON STRING. */
function callsOf(
  raw: string | null,
): readonly { id?: string; name: string; input?: unknown }[] | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const calls: { id?: string; name: string; input?: unknown }[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { call_id?: unknown; id?: unknown; function?: unknown }
    const fn = record.function as { name?: unknown; arguments?: unknown } | undefined
    const name = typeof fn?.name === 'string' ? fn.name : undefined
    if (!name) continue
    const id = typeof record.call_id === 'string' ? record.call_id : undefined
    let input: unknown
    if (typeof fn?.arguments === 'string') {
      try {
        input = JSON.parse(fn.arguments)
      } catch {
        // Arguments the provider wrote but we cannot parse stay as the string it wrote.
        input = fn.arguments
      }
    }
    calls.push({ ...(id ? { id } : {}), name, ...(input === undefined ? {} : { input }) })
  }
  return calls.length > 0 ? calls : undefined
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
    for (const row of rows) {
      const timestamp = msOf(row.timestamp)
      const at = timestamp === undefined ? {} : { timestamp }
      if (row.role === 'tool') {
        window.emit({
          ...base,
          role: 'tool',
          text: clip(resultText(row.content), req.maxCharsPerEvent),
          ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
          // Carried so a result whose call fell outside the window is still readable by name.
          ...(row.tool_name ? { toolName: row.tool_name } : {}),
          ...at,
        } as TranscriptEvent)
        continue
      }
      const role = row.role === 'user' ? 'user' : 'assistant'
      const text = row.content?.trim()
      if (text) {
        window.emit({
          ...base,
          role,
          text: clip(text, req.maxCharsPerEvent),
          ...at,
        } as TranscriptEvent)
      }
      // The calls live INSIDE the assistant row, so a turn whose prose is empty still carries work —
      // the mistake the Gemini adapter made by skipping a message on empty text alone.
      for (const call of callsOf(row.tool_calls) ?? []) {
        window.emit({
          ...base,
          role: 'assistant',
          text: '',
          toolName: call.name,
          ...(call.id ? { toolCallId: call.id } : {}),
          ...(call.input === undefined ? {} : { toolInput: call.input }),
          ...at,
        } as TranscriptEvent)
      }
    }
    return window.result()
  } finally {
    db.close()
  }
}

/**
 * See `ProviderAdapter.readTurnState`. Hermes keeps no append-only log, but it does not need one: it
 * WRITES DOWN that a session ended.
 *
 * Measured on a real local history's store: 18 of 19 sessions carry `ended_at`, with `end_reason` split
 * `cli_close` (14) and `new_session` (4); the one that does not has an assistant message from 1,392
 * hours ago. So an ended session is idle outright, and for the open one the last message's role is
 * the same question the appending formats answer — a `user` or `tool` row is the model being called,
 * an `assistant` row is the turn handed back.
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
}
