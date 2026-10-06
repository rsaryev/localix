import { shellQuote } from '@localixai/plugin-sdk/backend'
/**
 * Gemini CLI adapter — `gemini_cli_chat_recording_jsonl`.
 *
 * Root precedence: a `chats` directory under each project child of `$GEMINI_CLI_HOME/.gemini/tmp`
 * — or of `~/.gemini/tmp` when that variable is unset. Only bounded chat children are inspected
 * and the provider `.env` is never read: `MAX_PROJECT_DIRS` caps the walk, and nothing outside a
 * `chats` directory is read.
 *
 * The format token ends in `_jsonl`, but the real files are single JSON documents
 * (`{sessionId, projectHash, startTime, lastUpdated, messages[]}`), not JSON Lines. We parse what
 * is actually on disk and keep the token only as a cross-reference.
 *
 * Checked against real data: chat recordings under ~/.gemini/tmp/<projectHash>/chats.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
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
import { clip, pathExists, revisionOf } from './fs-read'
import { eventWindow } from './event-window'
import { TURN_EVIDENCE_MS, type TurnState } from '../live/turn-state'
import { linkKeyOf } from '../../shared/identity'
import { mapConcurrent } from './usage'

const SUMMARY_CONCURRENCY = 8
import { asNumber, asRecord, asString, firstText, textOfContent } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'

const ID = 'gemini-cli'
/** ctx marks this provider's discovery as "bounded chat children"; this is that bound made explicit. */
const MAX_PROJECT_DIRS = 512
/** A chat recording is a whole-document parse, so it needs its own ceiling rather than a window. */
const MAX_FILE_BYTES = 16 * 1024 * 1024

/**
 * Which absolute directory a chat was recorded in.
 *
 * The recording does not say — this adapter reported no cwd at all for that reason, and on this
 * machine that was 29 of the 48 sessions in the statistics' "no working directory recorded" bucket.
 * But Gemini keeps the answer beside the recordings: `~/.gemini/projects.json` maps ABSOLUTE PATH →
 * the short directory name under `tmp`, which is the name a chat is filed under. Inverting its own
 * file is not a guess.
 *
 * Two rules keep it from becoming one:
 *  - a short name that maps from more than one path resolves to NOTHING. Gemini derives the name
 *    from the last path segment, so two checkouts of the same repo would collide, and half-right
 *    attribution is worse here than none: `cwdPrefix` is a prefix filter, and a wrong prefix quietly
 *    moves sessions into another project's bar.
 *  - older recordings sit under a 64-hex directory instead. That is `sha256(absolutePath)` —
 *    verified with a synthetic fixture, where `193a59a1…` is the digest of
 *    `/Users/dev/Documents/ai-gateway`
 *    — so it is resolved by hashing the paths the map already lists, never by inverting a hash. A
 *    digest naming a path no longer in the map stays unresolved.
 */
async function projectPaths(env: AdapterEnv): Promise<Map<string, string>> {
  const explicit = env.env.GEMINI_CLI_HOME?.trim()
  const base = explicit ? join(explicit, '.gemini') : join(env.homeDir || homedir(), '.gemini')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(base, 'projects.json'), 'utf8'))
  } catch {
    // No map, or one we cannot read: every chat keeps the honest `undefined` it had before.
    return new Map()
  }
  const projects = asRecord(asRecord(parsed)?.projects)
  if (!projects) return new Map()
  const byName = new Map<string, string | null>()
  const byDigest = new Map<string, string>()
  for (const [path, rawName] of Object.entries(projects)) {
    const name = asString(rawName)
    if (!name) continue
    // `null` marks a name that has been claimed twice — it stays claimed.
    byName.set(name, byName.has(name) ? null : path)
    byDigest.set(createHash('sha256').update(path).digest('hex'), path)
  }
  const resolved = new Map<string, string>()
  for (const [name, path] of byName) if (path) resolved.set(name, path)
  for (const [digest, path] of byDigest) resolved.set(digest, path)
  return resolved
}

function tmpRoot(env: AdapterEnv): string {
  const explicit = env.env.GEMINI_CLI_HOME?.trim()
  const base = explicit ? join(explicit, '.gemini') : join(env.homeDir || homedir(), '.gemini')
  return join(base, 'tmp')
}

async function listSources(env: AdapterEnv): Promise<readonly SourceRef[]> {
  const root = tmpRoot(env)
  // One read for the whole scan: the map is a single small file shared by every project.
  const paths = await projectPaths(env)
  let projects: string[]
  try {
    projects = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .slice(0, MAX_PROJECT_DIRS)
  } catch {
    return []
  }
  const refs: SourceRef[] = []
  for (const project of projects) {
    const chats = join(root, project, 'chats')
    let names: string[]
    try {
      names = (await readdir(chats)).filter((n) => n.endsWith('.json'))
    } catch {
      continue
    }
    for (const name of names) {
      const full = join(chats, name)
      try {
        const info = await stat(full)
        if (info.size === 0 || info.size > MAX_FILE_BYTES) continue
        refs.push({
          // Identity comes from the document, not the filename — but reading every document during
          // enumeration would defeat the cheap-listing contract, so the filename stem stands in and
          // the summary corrects it. Filename stems are unique within `chats`, so no key collides.
          nativeSessionId: name.slice(0, -'.json'.length),
          sourcePath: full,
          revision: revisionOf(info.mtimeMs, info.size),
          sourceBytes: info.size,
          // The absolute path when Gemini's own map names one, and nothing at all otherwise — the
          // directory name is a label, and a label in a path filter matches nothing.
          ...(paths.get(project) ? { cwdHint: paths.get(project) as string } : {}),
          updatedAtHint: info.mtimeMs,
        })
      } catch {
        continue
      }
    }
  }
  return refs
}

interface GeminiDoc {
  sessionId?: unknown
  startTime?: unknown
  lastUpdated?: unknown
  messages?: unknown
}

async function loadDoc(path: string): Promise<GeminiDoc | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return asRecord(parsed) as GeminiDoc | undefined
  } catch {
    return undefined
  }
}

async function summarize(ref: SourceRef): Promise<SessionSummary> {
  const doc = await loadDoc(ref.sourcePath)
  // IDENTITY COMES FROM THE REF, never from the document.
  //
  // `listSources` must be cheap, so the id it can produce is the one derived from the file name —
  // and that is the id every key, link and lookup is built on. Overriding it here with the
  // document's own `sessionId` produced a roster whose keys named something `listSources` had never
  // heard of, so `findSource` matched nothing and EVERY Gemini session opened empty. The two ids
  // are both stable; only one of them can be the identity, and it has to be the cheap one.
  const nativeSessionId = ref.nativeSessionId
  const messages = Array.isArray(doc?.messages) ? doc.messages : []
  let firstPrompt: string | undefined
  for (const raw of messages) {
    const rec = asRecord(raw)
    if (rec?.type !== 'user') continue
    // `content` is a bare string on assistant turns but a `{text}[]` block array on user turns —
    // verified on real recordings. Reading only the string form silently yields empty transcripts.
    const content = textOfContent(rec.content)
    if (content) {
      firstPrompt = content
      break
    }
  }
  const started = asString(doc?.startTime)
  const updated = asString(doc?.lastUpdated)
  const usage = new SessionUsageAccumulator()
  let messageCount = 0
  for (const raw of messages) {
    const message = asRecord(raw)
    const type = asString(message?.type)
    if (type !== 'user' && type !== 'gemini') continue
    messageCount += 1
    if (type !== 'gemini') continue
    const tokens = asRecord(message?.tokens)
    if (!tokens) continue
    const timestampText = asString(message?.timestamp)
    usage.add(
      normalizeTokenSample({
        inputTokens: asNumber(tokens.input),
        cachedInputTokens: asNumber(tokens.cached),
        outputTokens: asNumber(tokens.output),
        reasoningTokens: asNumber(tokens.thoughts),
        totalTokens: asNumber(tokens.total),
        inputIncludesCached: true,
        reasoningIncludedInOutput: false,
      }),
      asString(message?.model),
      timestampText ? Date.parse(timestampText) || undefined : asNumber(message?.timestamp),
    )
  }
  const measured = usage.result()
  return {
    key: linkKeyOf({ provider: ID, nativeSessionId }),
    provider: ID,
    nativeSessionId,
    title: firstText(firstPrompt, 120) ?? ref.nativeSessionId,
    // The recording carries no cwd; `cwdHint` is what `~/.gemini/projects.json` resolved the chat's
    // own directory name to, and is absent when it resolved to nothing. Reporting the directory
    // name itself would be a label standing where a path belongs.
    ...(ref.cwdHint ? { cwd: ref.cwdHint } : {}),
    startedAt: started ? Date.parse(started) || undefined : undefined,
    updatedAt: (updated ? Date.parse(updated) : 0) || ref.updatedAtHint || Date.now(),
    ...(messageCount > 0 ? { messageCount } : {}),
    ...(measured ? { usage: measured } : {}),
    sourcePath: ref.sourcePath,
  }
}

/**
 * The readable output of a recorded tool call.
 *
 * Gemini keeps a call's result as the raw `functionResponse` envelope the model was handed back, so
 * the payload sits two levels in. An envelope we do not recognise is serialized rather than
 * dropped: an unfamiliar result is still evidence of what the agent did, and silently showing a
 * call with no OUT would read as a call that returned nothing.
 */
function toolOutputOf(result: unknown): string | undefined {
  if (!Array.isArray(result)) return undefined
  const parts: string[] = []
  for (const entry of result) {
    const response = asRecord(asRecord(entry)?.functionResponse)?.response
    if (response === undefined) continue
    const output = asRecord(response)?.output
    parts.push(typeof output === 'string' ? output : JSON.stringify(response))
  }
  const text = parts.join('\n').trim()
  return text || undefined
}

async function readTranscript(req: TranscriptRequest): Promise<TranscriptResult> {
  const doc = await loadDoc(req.ref.sourcePath)
  const messages = Array.isArray(doc?.messages) ? doc.messages : []
  const nativeSessionId = req.ref.nativeSessionId
  const window = eventWindow(req.maxEvents, req.tail, req.from)
  for (const raw of messages) {
    const rec = asRecord(raw)
    if (!rec) continue
    const type = asString(rec.type)
    const role = type === 'user' ? 'user' : type === 'gemini' ? 'assistant' : undefined
    if (!role) continue
    const ts = asString(rec.timestamp)
    const base = {
      provider: ID,
      nativeSessionId,
      timestamp: ts ? Date.parse(ts) || undefined : asNumber(rec.timestamp),
    }
    const text = textOfContent(rec.content)
    if (text) window.emit({ ...base, role, text: clip(text, req.maxCharsPerEvent) })
    /**
     * TOOL CALLS LIVE BESIDE THE TEXT, not inside it.
     *
     * A turn that only called tools records `content: ""` and puts everything in `toolCalls`, so
     * skipping empty-text messages — which this loop used to do before reading any further —
     * dropped the tool half of the session outright. Measured on a real recording: 148 of 193
     * messages carry `toolCalls`, and the transcript this adapter produced for them contained
     * nothing but user and assistant prose.
     */
    for (const entry of Array.isArray(rec.toolCalls) ? rec.toolCalls : []) {
      const call = asRecord(entry)
      const name = asString(call?.name)
      if (!call || !name) continue
      const callId = asString(call.id)
      window.emit({
        ...base,
        role: 'assistant',
        text: name,
        toolName: name,
        ...(callId ? { toolCallId: callId } : {}),
        ...(call.args === undefined ? {} : { toolInput: call.args }),
      })
      const output = toolOutputOf(call.result)
      if (output === undefined) continue
      window.emit({
        // A result is the tool speaking. It carries the call's id and not its name: the id is
        // what `resultFor` pairs on, and it is exact where a name is only adjacent.
        ...base,
        role: 'tool',
        text: clip(output, req.maxCharsPerEvent),
        ...(callId ? { toolCallId: callId } : {}),
      })
    }
  }
  return window.result()
}

/**
 * See `ProviderAdapter.readTurnState`. Gemini keeps no append-only log — it rewrites the whole chat
 * document — so the answer is the document's LAST message rather than a file's last bytes.
 *
 * Measured across 29 real recordings: the final message is `info` in 20 of them, and every
 * `info` seen was "Request cancelled." — an interruption, which means nothing is running. Reading
 * past those notices, the last real message is `user` in 15, `gemini` in 8, `gemini` carrying tool
 * calls in 4 and `error` in 2. Of the four with calls, NONE had a call still missing its result:
 * this format records a call and its result together, so a call is evidence of a turn only while one
 * is unfinished.
 */
async function readTurnState(
  ref: SourceRef,
  _env: AdapterEnv,
  now: number,
): Promise<TurnState | undefined> {
  const doc = await loadDoc(ref.sourcePath)
  const messages = Array.isArray(doc?.messages) ? doc.messages : []
  const fresh = now - (ref.updatedAtHint ?? now) <= TURN_EVIDENCE_MS
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    const type = asString(message?.type)
    if (!type) continue
    // A notice is written when the turn is not running: "Request cancelled." is every one here.
    if (type === 'info' || type === 'error') return 'idle'
    if (type === 'user') return fresh ? 'working' : undefined
    if (type === 'gemini') {
      const calls = Array.isArray(message?.toolCalls) ? message.toolCalls : []
      const pending = calls.some((call) => asRecord(call)?.result === undefined)
      if (!pending) return 'idle'
      return fresh ? 'working' : undefined
    }
  }
  return undefined
}

export const geminiCliAdapter: ProviderAdapter = {
  id: ID,
  command: 'gemini',
  displayName: 'Gemini CLI',
  sourceFormat: 'gemini_cli_chat_recording_jsonl',
  verified: true,
  detectionManifestId: 'gemini-cli',
  async probeRoots(env: AdapterEnv): Promise<readonly RootProbe[]> {
    const path = tmpRoot(env)
    return [{ path, exists: await pathExists(path) }]
  },
  listSources,
  async readSummaries(refs) {
    // Bounded like every other adapter: `Promise.all` opened every chat recording at once.
    return mapConcurrent(refs, SUMMARY_CONCURRENCY, summarize)
  },
  readTranscript,
  readTurnState,
  resumeCommand: (id) => `gemini --resume ${shellQuote(id)}`,
}
