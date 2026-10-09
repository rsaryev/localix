/**
 * Claude Code adapter — `claude_projects_jsonl_tree`.
 *
 * Root precedence: `$CLAUDE_CONFIG_DIR/projects` when that variable is set, otherwise
 * `~/.claude/projects`. A replacement env var REPLACES the default rather than being searched
 * beside it, because probing both would attribute sessions to a root the user has deliberately
 * switched away from.
 *
 * Checked against real transcript data under ~/.claude/projects.
 */

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { shellQuote } from '@localixai/plugin-sdk/backend'
import type {
  AdapterEnv,
  ProviderAdapter,
  RootProbe,
  SourceRef,
  TranscriptRequest,
  TranscriptResult,
} from './types'
import { clip, pathExists, revisionOf, jsonlRecords } from './fs-read'
import { eventWindow } from './event-window'
import { tailTurnState, TURN_TAIL_BYTES } from '../live/turn-state'
import { asRecord, asString, contentParts } from './json-util'
import { mapConcurrent } from './usage'
import { ID, summarizeClaudeCode as summarize } from './claude-summary'

const SUMMARY_CONCURRENCY = 8

function rootFor(env: AdapterEnv): string {
  const replacement = env.env.CLAUDE_CONFIG_DIR?.trim()
  if (replacement) return join(replacement, 'projects')
  return join(env.homeDir || homedir(), '.claude', 'projects')
}

/**
 * Claude Code encodes the project cwd into a directory name by replacing `/` with `-`. That is
 * LOSSY and not invertible: a real directory named `inpay-workspace` produces the same dashes as a
 * nested `inpay/workspace`. So the decoded value is only ever a HINT used until the transcript's
 * own `cwd` field is read, and never presented as the authoritative path.
 */
function decodeCwdHint(dirName: string): string | undefined {
  if (!dirName.startsWith('-')) return undefined
  return dirName.replace(/-/g, '/')
}

/**
 * Real layout under `projects/<slug>/`, confirmed by walking a real history of 410 transcripts:
 *
 *   <uuid>.jsonl                                        top-level session          (86 here)
 *   <uuid>/subagents/agent-<hex>.jsonl                   sub-agent transcript      (220 here)
 *   <uuid>/subagents/workflows/<wf>/agent-<hex>.jsonl    nested sub-agent          (104 here)
 *   <uuid>/subagents/workflows/<wf>/journal.jsonl        NOT a transcript
 *   <uuid>/tool-results/…                                NOT transcripts
 *   memory/…                                             NOT transcripts
 *
 * A depth-1 readdir — the obvious implementation — silently finds only the 86 and loses 79% of the
 * history. This provider records parent/child session edges, and these child files
 * are the edges. They are indexed as real sessions carrying `parentNativeSessionId`, so the roster
 * can fold them under their parent instead of either dropping or drowning in them.
 */
const NON_TRANSCRIPT_DIRS = new Set(['tool-results', 'memory'])
/**
 * A workflow's `journal.jsonl` is the orchestrator's own record — `{type, key, agentId, result}`
 * rows, no roles and no turns — so it belongs beside `tool-results/`, not in a list of
 * conversations. Verified by reading one: 22 rows, not one of them a message.
 */
const NON_TRANSCRIPT_FILES = new Set(['journal.jsonl'])
const UUID_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The two documented transcript shapes. Their names are unique by construction, not by luck. */
const UUID_STEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUBAGENT_STEM = /^agent-[0-9a-z]+$/i

/**
 * A ref's id, which MUST be unique within this provider: it is half of the `<provider>:<id>` key
 * that every link, drag, cache entry and lookup is built on.
 *
 * For the two shapes above the filename is already unique, so the stem is the id and stays the id —
 * every key already minted has to keep resolving. Anything else is qualified with its directory,
 * because a bare stem is unique only by convention and this machine already had 33 files answering
 * to `claude-code:journal`. `findSource` takes the first match, so opening any of them opened
 * whichever the walk happened to reach first.
 */
function sessionIdFor(name: string, full: string): string {
  const stem = name.slice(0, -'.jsonl'.length)
  if (UUID_STEM.test(stem) || SUBAGENT_STEM.test(stem)) return stem
  return `${basename(dirname(full))}/${stem}`
}

interface Found {
  readonly full: string
  readonly name: string
  readonly parent?: string
}

async function walkProject(
  dir: string,
  depth: number,
  parent: string | undefined,
  out: Found[],
): Promise<void> {
  if (depth < 0) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (NON_TRANSCRIPT_DIRS.has(entry.name)) continue
      // A UUID-named directory is the session whose children live beneath it — that name IS the
      // parent edge, and it is available without opening a single file.
      const nextParent = UUID_DIR.test(entry.name) ? entry.name : parent
      await walkProject(join(dir, entry.name), depth - 1, nextParent, out)
    } else if (entry.name.endsWith('.jsonl') && !NON_TRANSCRIPT_FILES.has(entry.name)) {
      out.push({ full: join(dir, entry.name), name: entry.name, parent })
    }
  }
}

async function listSources(env: AdapterEnv): Promise<readonly SourceRef[]> {
  const root = rootFor(env)
  let projectDirs: string[]
  try {
    projectDirs = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
  const refs: SourceRef[] = []
  for (const dir of projectDirs) {
    const found: Found[] = []
    await walkProject(join(root, dir), 5, undefined, found)
    const cwdHint = decodeCwdHint(dir)
    const stats = await Promise.all(
      found.map(async (f) => {
        try {
          const info = await stat(f.full)
          return { ...f, mtimeMs: info.mtimeMs, size: info.size }
        } catch {
          return null
        }
      }),
    )
    for (const s of stats) {
      if (!s || s.size === 0) continue
      refs.push({
        nativeSessionId: sessionIdFor(s.name, s.full),
        sourcePath: s.full,
        revision: revisionOf(s.mtimeMs, s.size),
        sourceBytes: s.size,
        cwdHint,
        updatedAtHint: s.mtimeMs,
        parentHint: s.parent,
      })
    }
  }
  return refs
}

async function readTranscript(req: TranscriptRequest): Promise<TranscriptResult> {
  let truncated = false
  const window = eventWindow(req.maxEvents, req.tail, req.from)
  for await (const rec of jsonlRecords(req.ref.sourcePath, 32 * 1024 * 1024, {
    fromEnd: req.tail === true,
    onTruncated: () => {
      truncated = true
    },
  })) {
    const type = asString(rec.type)
    if (type !== 'user' && type !== 'assistant') continue
    if (rec.isMeta === true) continue
    const message = asRecord(rec.message)
    if (!message) continue
    const ts = asString(rec.timestamp)
    const timestamp = ts ? Date.parse(ts) || undefined : undefined
    // One event per CONTENT BLOCK, not per message. A message that says "let me check" and then
    // calls Bash is two different things to a reader, and flattening them into one string is what
    // made a tool call render as the literal text `[tool: Bash]`.
    for (const part of contentParts(message.content)) {
      const base = {
        provider: ID,
        nativeSessionId: req.ref.nativeSessionId,
        timestamp,
      }
      if (part.kind === 'tool_use') {
        window.emit({
          ...base,
          role: 'assistant',
          text: part.name,
          toolName: part.name,
          ...(part.id ? { toolCallId: part.id } : {}),
          toolInput: part.input,
        })
        continue
      }
      if (part.kind === 'tool_result') {
        window.emit({
          ...base,
          // A result is the tool speaking, whichever message envelope carried it back.
          role: 'tool',
          text: clip(part.text, req.maxCharsPerEvent),
          ...(part.id ? { toolCallId: part.id } : {}),
        })
        continue
      }
      window.emit({ ...base, role: type, text: clip(part.text, req.maxCharsPerEvent) })
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

export const claudeCodeAdapter: ProviderAdapter = {
  id: ID,
  command: 'claude',
  displayName: 'Claude Code',
  sourceFormat: 'claude_projects_jsonl_tree',
  verified: true,
  detectionManifestId: 'claude-code',
  resumeCommand: (id) => `claude --resume ${shellQuote(id)}`,
  async probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]> {
    const path = rootFor(env)
    return [{ path, exists: await pathExists(path) }]
  },
  listSources,
  async readSummaries(refs) {
    return mapConcurrent(refs, SUMMARY_CONCURRENCY, summarize)
  },
  readTranscript,
  readTurnState,
}
