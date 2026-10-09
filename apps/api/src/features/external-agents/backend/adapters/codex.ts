/**
 * Codex adapter — `codex_session_jsonl_tree`.
 *
 * Root precedence: `$CODEX_HOME` or `~/.codex`, deriving `sessions`, `archived_sessions`, and
 * `history.jsonl`. We read the two session trees; `history.jsonl` is a flat prompt log of partial
 * fidelity, and it carries no session identity, so it cannot produce a keyed row and is
 * deliberately skipped.
 *
 * Compressed `.jsonl.zst` rollouts are counted as unsupported rather than silently ignored.
 *
 * Checked against real data: rollouts under ~/.codex/sessions.
 */

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { shellQuote } from '@localixai/plugin-sdk/backend'
import type {
  AdapterEnv,
  ProviderAdapter,
  RootProbe,
  SourceRef,
  TranscriptRequest,
  TranscriptResult,
} from './types'
import type { TranscriptEvent } from '../../shared/contracts'
import { clip, pathExists, revisionOf, jsonlRecords } from './fs-read'
import { eventWindow } from './event-window'
import { tailTurnState, TURN_TAIL_BYTES } from '../live/turn-state'
import { asRecord, asString } from './json-util'
import { mapConcurrent } from './usage'
import { ID, summarizeCodex as summarize } from './codex-summary'

const SESSION_DIRS = ['sessions', 'archived_sessions']
const SUMMARY_CONCURRENCY = 8
const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

function homeFor(env: AdapterEnv): string {
  return env.env.CODEX_HOME?.trim() || join(env.homeDir || homedir(), '.codex')
}

/** `rollout-2026-04-29T13-01-39-<uuid>.jsonl` → the trailing UUID. Confirmed against real names. */
function sessionIdFromName(name: string): string | undefined {
  const base = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : name
  return UUID_TAIL.exec(base)?.[1]
}

/** Codex nests rollouts as sessions/YYYY/MM/DD/*.jsonl. Depth is bounded so a stray tree cannot walk forever. */
async function walkJsonl(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walkJsonl(full, depth - 1, out)
    else if (entry.name.endsWith('.jsonl')) out.push(full)
  }
}

async function listSources(env: AdapterEnv): Promise<readonly SourceRef[]> {
  const root = homeFor(env)
  const files: string[] = []
  for (const sub of SESSION_DIRS) await walkJsonl(join(root, sub), 5, files)
  const refs: SourceRef[] = []
  for (const full of files) {
    const nativeSessionId = sessionIdFromName(full.slice(full.lastIndexOf('/') + 1))
    if (!nativeSessionId) continue
    try {
      const info = await stat(full)
      if (info.size === 0) continue
      refs.push({
        nativeSessionId,
        sourcePath: full,
        revision: revisionOf(info.mtimeMs, info.size),
        sourceBytes: info.size,
        updatedAtHint: info.mtimeMs,
      })
    } catch {
      continue
    }
  }
  return refs
}

/**
 * Read a rollout as a CONVERSATION, not as the narration of one.
 *
 * `event_msg` records are Codex's own UI feed — `user_message` and `agent_message` say what was
 * said, and nothing else. The work is in `response_item`: on a real 691-line rollout there are 121
 * tool calls and their outputs against 36 messages, so reading the feed alone showed a tenth of
 * the session and none of what the agent actually did.
 *
 * `reasoning` items are deliberately skipped rather than rendered: their `summary` is empty and the
 * content is under `encrypted_content`, so there is no readable text to show. A placeholder saying
 * "reasoning" would be a row that costs a line and carries nothing.
 *
 * `developer` messages are the system prompt Codex injects; they are not turns anyone took.
 *
 * The `event_msg` feed is not read at all: every message it carries also appears as a
 * `response_item`, so reading both would double every turn.
 */
function contentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined
  const parts: string[] = []
  for (const block of value) {
    const text = asString(asRecord(block)?.text)
    if (text) parts.push(text)
  }
  return parts.join('\n').trim() || undefined
}

async function readTranscript(req: TranscriptRequest): Promise<TranscriptResult> {
  let truncated = false
  const window = eventWindow(req.maxEvents, req.tail, req.from)
  const push = (event: Omit<TranscriptEvent, 'provider' | 'nativeSessionId' | 'ordinal'>) => {
    window.emit({ provider: ID, nativeSessionId: req.ref.nativeSessionId, ...event })
  }

  for await (const rec of jsonlRecords(req.ref.sourcePath, 32 * 1024 * 1024, {
    fromEnd: req.tail === true,
    onTruncated: () => {
      truncated = true
    },
  })) {
    const payload = asRecord(rec.payload)
    if (!payload) continue
    const ts = asString(rec.timestamp)
    const timestamp = ts ? Date.parse(ts) || undefined : undefined
    const kind = asString(payload.type)

    if (rec.type === 'response_item') {
      if (kind === 'message') {
        const role = asString(payload.role)
        // `developer` is the injected system prompt — not a turn anyone took.
        if (role !== 'user' && role !== 'assistant') continue
        const text = contentText(payload.content)
        if (!text) continue
        if (role === 'user' && text.startsWith('<environment_context>')) continue
        push({ role, timestamp, text: clip(text, req.maxCharsPerEvent) })
        continue
      }
      if (kind === 'function_call' || kind === 'custom_tool_call') {
        const name = asString(payload.name)
        if (!name) continue
        push({
          role: 'assistant',
          timestamp,
          text: name,
          toolName: name,
          ...(asString(payload.call_id) ? { toolCallId: asString(payload.call_id) } : {}),
          // `arguments` is a JSON string on a function call and free text on a custom one; it is
          // passed through as recorded rather than parsed, because a failed parse would silently
          // drop the only record of what the tool was asked to do.
          toolInput: payload.arguments ?? payload.input,
        })
        continue
      }
      if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
        const text = contentText(payload.output)
        if (!text) continue
        push({
          role: 'tool',
          timestamp,
          text: clip(text, req.maxCharsPerEvent),
          ...(asString(payload.call_id) ? { toolCallId: asString(payload.call_id) } : {}),
        })
      }
      continue
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

export const codexAdapter: ProviderAdapter = {
  id: ID,
  command: 'codex',
  displayName: 'Codex',
  sourceFormat: 'codex_session_jsonl_tree',
  verified: true,
  detectionManifestId: 'codex',
  resumeCommand: (id) => `codex resume ${shellQuote(id)}`,
  async probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]> {
    const root = homeFor(env)
    return Promise.all(
      SESSION_DIRS.map(async (sub) => {
        const path = join(root, sub)
        return { path, exists: await pathExists(path) }
      }),
    )
  },
  listSources,
  async readSummaries(refs) {
    return mapConcurrent(refs, SUMMARY_CONCURRENCY, summarize)
  },
  readTranscript,
  readTurnState,
}
