import { shellQuote } from '@localixai/plugin-sdk/backend'
/**
 * GitHub Copilot CLI — `~/.copilot/session-state/<uuid>/events.jsonl`.
 *
 * Found by asking which agent CLIs are actually installed rather than which ones we had already
 * written adapters for: `copilot` is commonly installed, gets used, and leaves history nothing else
 * in this plugin could see — large `events.jsonl` logs with a cwd and a usable title on every
 * session.
 *
 * Many session directories hold no `events.jsonl` at all (some hold a `session.db` and nothing
 * else). A directory is therefore not a session — the log is — which is why enumeration stats the
 * file rather than trusting the directory listing.
 *
 * The format is the most structured of the five. Every line is `{ type, data, id, timestamp,
 * parentId }`, and the types we need are exactly the ones a transcript is made of:
 *
 *   session.start            identity — sessionId, startTime, selectedModel, context.cwd/gitRoot
 *   user.message             prose
 *   assistant.message        prose, plus `toolRequests` and an `outputTokens` count
 *   tool.execution_start     toolCallId + toolName + arguments
 *   tool.execution_complete  toolCallId + success + result.content
 *
 * Tool calls arrive as their OWN events carrying the provider's `toolCallId`, so a result is paired
 * with its call by id rather than by adjacency — the pairing the other adapters have to work for.
 * That also means an `assistant.message` whose prose is empty carries nothing we lose by skipping it,
 * unlike Gemini CLI, where the calls live inside the message.
 *
 * NO TOKEN USAGE IS REPORTED, deliberately. Copilot records `outputTokens` per assistant message and
 * no input count anywhere — checked across eight real sessions: 1,805 messages with `outputTokens`,
 * zero fields matching an input count. `session.shutdown` reports `conversationTokens` /
 * `systemTokens` / `toolDefinitionsTokens`, which describe the context at exit, not what was
 * consumed. An output-only total would land in the same "Tokens processed" tile as providers that
 * report input, cache reads and writes, making Copilot look an order of magnitude cheaper than it
 * was. `usageSessions` already says "measured for N of M", so leaving it out is a figure withheld,
 * not a figure lost.
 *
 * `COPILOT_HOME` replaces the root rather than being searched beside it — same rule as `CODEX_HOME`;
 * the name is read from the installed binary's own strings. `sourceFormat` is our own token.
 */

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  AdapterEnv,
  FoldedSummary,
  ProviderAdapter,
  RootProbe,
  SourceRef,
  TranscriptRequest,
  TranscriptResult,
} from './types'
import type { SessionSummary, TranscriptEvent } from '../../shared/contracts'
import { clip, pathExists, revisionOf, jsonlRecords } from './fs-read'
import { foldOnward, resumableFold } from './summary-fold'
import { firstText } from './json-util'
import { eventWindow } from './event-window'
import { tailTurnState, TURN_TAIL_BYTES } from '../live/turn-state'
import { linkKeyOf } from '../../shared/identity'
import { mapConcurrent } from './usage'

const ID = 'github-copilot'
/** Bounded like the other adapters: a session that grew past this is read up to here, never whole. */
const MAX_FILE_BYTES = 32 * 1024 * 1024
/**
 * The bound the other adapters pass to `firstText`: a title is a NAME, one line with one ellipsis.
 * `clip`, which this used, is for event BODIES and appended a `\n[... N more characters]` marker.
 */
const TITLE_CHARS = 120
/** Matches the other adapters: enough parallelism to hide I/O latency, not enough to thrash. */
const SUMMARY_CONCURRENCY = 8

function homeFor(env: AdapterEnv): string {
  const replacement = env.env.COPILOT_HOME?.trim()
  return replacement && replacement.length > 0
    ? replacement
    : join(env.homeDir || homedir(), '.copilot')
}

function sessionsDir(env: AdapterEnv): string {
  return join(homeFor(env), 'session-state')
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

async function probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]> {
  const path = sessionsDir(env)
  return [{ path, exists: await pathExists(path) }]
}

/**
 * One directory per session, each holding `events.jsonl` beside a `session.db`. Only the JSONL is
 * read: the database is Copilot's own working state, and a second reader of it would be a second
 * source of truth for the same session.
 */
async function listSources(env: AdapterEnv): Promise<readonly SourceRef[]> {
  const root = sessionsDir(env)
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const refs: SourceRef[] = []
  for (const entry of entries) {
    const events = join(root, entry, 'events.jsonl')
    try {
      const info = await stat(events)
      if (!info.isFile()) continue
      refs.push({
        nativeSessionId: entry,
        sourcePath: events,
        revision: revisionOf(info.mtimeMs, info.size),
        sourceBytes: info.size,
        updatedAtHint: info.mtimeMs,
      })
    } catch {
      // A directory without an events file is Copilot's own bookkeeping, not a session.
    }
  }
  return refs
}

/** Copilot records no title; the first thing a person said is carried, since the head moves on. */
type Carry = { readonly title?: string }

/** What a summary reads; tool traffic, the bulk of the file, is skipped before it is parsed. */
const SUMMARY_LINE = (line: string) =>
  line.includes('"session.start"') || line.includes('.message"')

async function summarize(ref: SourceRef): Promise<SessionSummary> {
  return (await foldSummary(ref, undefined)).summary
}

/** The summary, continued from where the previous fold of this append-only log stopped. */
async function foldSummary(
  ref: SourceRef,
  previous: FoldedSummary | undefined,
): Promise<FoldedSummary> {
  const resumed = await resumableFold(ref, previous)
  const prior = resumed?.summary
  let cwd = prior?.cwd
  let model = prior?.model
  let startedAt = prior?.startedAt
  let title = (resumed?.fold?.carry as Carry | undefined)?.title
  let messageCount = prior?.messageCount ?? 0
  // Bounded like the whole-file read it replaces: past the cap, the summary stops growing.
  const end = Math.min(ref.sourceBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES)
  const fold = await foldOnward(
    ref,
    resumed,
    end,
    SUMMARY_LINE,
    (rec) => {
      const type = asString(rec.type)
      if (!type) return
      const data = asRecord(rec.data)
      if (type === 'session.start') {
        const context = asRecord(data?.context)
        cwd = asString(context?.cwd) ?? asString(context?.gitRoot)
        model = asString(data?.selectedModel)
        const start = asString(data?.startTime) ?? asString(rec.timestamp)
        startedAt = start ? Date.parse(start) || undefined : undefined
        return
      }
      if (type === 'user.message' || type === 'assistant.message') {
        messageCount += 1
        // The first thing a person said is the only title this format offers — it records none.
        if (title === undefined && type === 'user.message') {
          const content = asString(data?.content)
          if (content) title = firstText(content, TITLE_CHARS)
        }
      }
    },
    (): Carry => (title ? { title } : {}),
  )

  const summary: SessionSummary = {
    key: linkKeyOf({ provider: ID, nativeSessionId: ref.nativeSessionId }),
    provider: ID,
    nativeSessionId: ref.nativeSessionId,
    title: title || ref.nativeSessionId,
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(startedAt ? { startedAt } : {}),
    updatedAt: ref.updatedAtHint ?? Date.now(),
    ...(messageCount > 0 ? { messageCount } : {}),
    sourcePath: ref.sourcePath,
  }
  return { summary, fold }
}

/** The tool result's payload, preferring the detailed form the CLI shows on request. */
function resultText(data: Record<string, unknown> | undefined): string {
  const result = asRecord(data?.result)
  const detailed = asString(result?.detailedContent)
  const content = asString(result?.content)
  const text = detailed ?? content
  if (text) return text
  // An unrecognised envelope is serialized rather than dropped: a call showing no output would read
  // as a call that returned nothing.
  return result ? JSON.stringify(result) : ''
}

async function readTranscript(req: TranscriptRequest): Promise<TranscriptResult> {
  let truncated = false
  const window = eventWindow(req.maxEvents, req.tail, req.from)
  const base = { provider: ID, nativeSessionId: req.ref.nativeSessionId } as const

  for await (const rec of jsonlRecords(req.ref.sourcePath, MAX_FILE_BYTES, {
    fromEnd: req.tail === true,
    onTruncated: () => {
      truncated = true
    },
  })) {
    const type = asString(rec.type)
    if (!type) continue
    const data = asRecord(rec.data)
    const stamp = asString(rec.timestamp)
    const timestamp = stamp ? Date.parse(stamp) || undefined : undefined
    const at = timestamp === undefined ? {} : { timestamp }

    if (type === 'user.message' || type === 'assistant.message') {
      const content = asString(data?.content)
      // An assistant turn that only called tools records empty prose; its calls arrive as their own
      // events, so there is nothing here to keep.
      if (!content) continue
      window.emit({
        ...base,
        role: type === 'user.message' ? 'user' : 'assistant',
        text: clip(content, req.maxCharsPerEvent),
        ...at,
      } as TranscriptEvent)
      continue
    }
    if (type === 'tool.execution_start') {
      const toolName = asString(data?.toolName)
      if (!toolName) continue
      const callId = asString(data?.toolCallId)
      window.emit({
        ...base,
        role: 'assistant',
        text: '',
        toolName,
        ...(callId ? { toolCallId: callId } : {}),
        ...(data?.arguments === undefined ? {} : { toolInput: data.arguments }),
        ...at,
      } as TranscriptEvent)
      continue
    }
    if (type === 'tool.execution_complete') {
      const callId = asString(data?.toolCallId)
      window.emit({
        ...base,
        role: 'tool',
        text: clip(resultText(data), req.maxCharsPerEvent),
        ...(callId ? { toolCallId: callId } : {}),
        ...at,
      } as TranscriptEvent)
    }
  }

  return { ...window.result(), ...(truncated ? { sourceTruncated: true } : {}) }
}

/** See `ProviderAdapter.readTurnState`: this format appends, so its last records answer. */
async function readTurnState(ref: SourceRef, _env: AdapterEnv, now: number) {
  return tailTurnState(
    ref.sourcePath,
    TURN_TAIL_BYTES,
    ref.updatedAtHint ?? now,
    now,
    (path, bytes) => jsonlRecords(path, bytes, { fromEnd: true }),
  )
}

export const githubCopilotAdapter: ProviderAdapter = {
  id: ID,
  command: 'copilot',
  displayName: 'GitHub Copilot',
  sourceFormat: 'copilot_session_state_jsonl',
  verified: true,
  detectionManifestId: ID,
  probeRoots,
  listSources,
  async readSummaries(refs) {
    return mapConcurrent(refs, SUMMARY_CONCURRENCY, summarize)
  },
  foldSummary: (ref, previous) => foldSummary(ref, previous),
  readTranscript,
  readTurnState,
  resumeCommand: (id) => `copilot --resume=${shellQuote(id)}`,
}
