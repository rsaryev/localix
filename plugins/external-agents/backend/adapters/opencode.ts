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
import { eventWindow } from './event-window'
import { TURN_EVIDENCE_MS, type TurnState } from '../live/turn-state'
import { linkKeyOf } from '../../shared/identity'
import { asRecord, asString, firstText, textOfContent } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'

const ID = 'opencode'

/**
 * Text a harness injected into the conversation rather than something a person typed.
 *
 * Every one of these opens a turn that LOOKS like a user message, so a title taken from the first
 * user text lands on the harness's own preamble. The shapes are the providers' own markers, matched
 * at the start only — a message that merely mentions one is still a message.
 */
function isInjectedBlock(text: string): boolean {
  return /^\s*<(system-reminder|environment_context|command-name|local-command|permissions)/.test(
    text,
  )
}

/** opencode's own unnamed-session title. Matching it is what tells a placeholder from a real name. */
const PLACEHOLDER_TITLE = /^New session - \d{4}-\d{2}-\d{2}T/

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

interface SessionRow {
  id: string
  parent_id: string | null
  directory: string
  title: string
  time_created: number
  time_updated: number
}

interface MessageCountRow {
  session_id: string
  messages: number
}

interface UsageRow {
  session_id: string
  day: string
  model: string | null
  requests: number
  input_tokens: number
  cached_input_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_tokens: number
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
    const messageCounts = new Map(
      db
        .query<MessageCountRow, []>(
          `select session_id, count(*) as messages
             from message
            where json_extract(data, '$.role') in ('user', 'assistant')
            group by session_id`,
        )
        .all()
        .map((row) => [row.session_id, row.messages]),
    )
    const usageBySession = new Map<string, SessionUsageAccumulator>()
    const usageRows = db
      .query<UsageRow, []>(
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
          where json_extract(data, '$.role') = 'assistant'
            and json_type(data, '$.tokens') is not null
          group by session_id, day, model`,
      )
      .all()
    for (const usageRow of usageRows) {
      if (!wanted.has(usageRow.session_id)) continue
      const accumulator = usageBySession.get(usageRow.session_id) ?? new SessionUsageAccumulator()
      accumulator.add(
        normalizeTokenSample(
          {
            inputTokens: usageRow.input_tokens,
            cachedInputTokens: usageRow.cached_input_tokens,
            cacheWriteTokens: usageRow.cache_write_tokens,
            outputTokens: usageRow.output_tokens,
            reasoningTokens: usageRow.reasoning_tokens,
            totalTokens: usageRow.total_tokens,
            reasoningIncludedInOutput: false,
          },
          usageRow.requests,
        ),
        usageRow.model ?? undefined,
        Date.parse(`${usageRow.day}T00:00:00.000Z`),
      )
      usageBySession.set(usageRow.session_id, accumulator)
    }

    const out: SessionSummary[] = []
    for (const row of rows) {
      if (!wanted.has(row.id)) continue
      let title = row.title || ''
      if (!title || PLACEHOLDER_TITLE.test(title)) {
        // A few, not one: the opening turns of a session are often injected context rather than
        // anything the user typed, and titling a session after a system reminder names the harness
        // instead of the work.
        for (const part of firstPrompt.all(row.id)) {
          const text = asString(asRecord(safeParse(part.data))?.text)
          if (!text || isInjectedBlock(text)) continue
          title = firstText(text, 120) ?? title
          break
        }
      }
      const measured = usageBySession.get(row.id)?.result()
      out.push({
        key: linkKeyOf({ provider: ID, nativeSessionId: row.id }),
        provider: ID,
        nativeSessionId: row.id,
        title: title || row.id,
        cwd: row.directory || undefined,
        startedAt: row.time_created,
        updatedAt: row.time_updated,
        ...(messageCounts.has(row.id) ? { messageCount: messageCounts.get(row.id) } : {}),
        ...(measured ? { usage: measured } : {}),
        sourcePath: path,
        parentNativeSessionId: row.parent_id ?? undefined,
      })
    }
    return out
  } finally {
    db.close()
  }
}

interface MessageRow {
  id: string
  time_created: number
  data: string
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
    // `state` holding the input and the output. In a real local history that is 868 of 3000 sampled parts:
    // the majority of the session, and all of the work.
    const parts = partsFor.all(req.ref.nativeSessionId)
    const byMessage = new Map<string, Record<string, unknown>[]>()
    for (const part of parts) {
      const data = asRecord(safeParse(part.data))
      if (!data) continue
      const list = byMessage.get(part.message_id)
      if (list) list.push(data)
      else byMessage.set(part.message_id, [data])
    }

    const window = eventWindow(req.maxEvents, req.tail, req.from)
    const push = (event: Omit<TranscriptEvent, 'provider' | 'nativeSessionId' | 'ordinal'>) => {
      window.emit({ provider: ID, nativeSessionId: req.ref.nativeSessionId, ...event })
    }

    for (const message of messages) {
      const data = asRecord(safeParse(message.data))
      const role = asString(data?.role)
      if (role !== 'user' && role !== 'assistant') continue
      const timestamp = message.time_created

      for (const part of byMessage.get(message.id) ?? []) {
        const type = asString(part.type)
        // `step-start` / `step-finish` are turn bookkeeping with nothing to read; `compaction` is
        // opencode's own history surgery. None of them is something anyone said or did.
        if (type === 'tool') {
          const state = asRecord(part.state)
          const name = asString(part.tool)
          if (!name) continue
          const callId = asString(part.callID)
          push({
            role: 'assistant',
            timestamp,
            text: name,
            toolName: name,
            ...(callId ? { toolCallId: callId } : {}),
            toolInput: state?.input,
          })
          const output = asString(state?.output) ?? textOfContent(state?.output)
          if (output) {
            push({
              role: 'tool',
              timestamp,
              text: clip(output, req.maxCharsPerEvent),
              ...(callId ? { toolCallId: callId } : {}),
            })
          }
          continue
        }
        const text = asString(part.text) ?? textOfContent(part.content)
        if (!text) continue
        // Reasoning is a real part here (unlike Codex, which encrypts it), so it is carried as the
        // `system` role the projection renders as a muted strip rather than as a spoken turn.
        push({
          role: type === 'reasoning' ? 'system' : role,
          timestamp,
          text: clip(text, req.maxCharsPerEvent),
        })
      }
    }
    return window.result()
  } finally {
    db.close()
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * See `ProviderAdapter.readTurnState`. opencode keeps no append-only log — its history is a
 * database, one row per message — so the answer is the NEWEST message row rather than a file's last
 * bytes.
 *
 * Measured on a real local history's store: taking the newest message of each session gives
 * `assistant` with `time.completed` set in 5 sessions and `assistant` still open in 3. A completed
 * assistant message is the turn handed back; an open one is a model mid-stream, and a `user` row is
 * a model about to be called.
 *
 * NOT read from the JSON tree beside the database, even though the same messages are there: the
 * newest file by name is the newest by mtime in only 3 of 11 sessions, so answering from it would
 * mean stat-ing every message of a session — 173 files in the largest here — to sort them.
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
  displayName: 'opencode',
  sourceFormat: 'opencode_sqlite',
  verified: true,
  detectionManifestId: 'opencode',
  resumeCommand: (id) => `opencode --session ${id}`,
  async probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]> {
    const path = dbPath(env)
    return [{ path, exists: isDiskPath(path) && (await pathExists(path)) }]
  },
  listSources,
  readSummaries,
  readTranscript,
  readTurnState,
}
