import { shellQuote } from '@localixai/mini-app-sdk/backend'
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
import { pathExists, revisionOf } from './fs-read'
import type { TurnState } from '../live/turn-state'
import { mapConcurrent } from './usage'

const SUMMARY_CONCURRENCY = 8
import { asRecord, asString } from './json-util'
import {
  ID,
  summarizeGeminiDoc,
  transcriptFromGeminiDoc,
  turnStateFromGeminiDoc,
  type GeminiDoc,
} from './gemini-recording'

/** ctx marks this provider's discovery as "bounded chat children"; this is that bound made explicit. */
const MAX_PROJECT_DIRS = 512
/** A chat recording is a whole-document parse, so it needs its own ceiling rather than a window. */
const MAX_FILE_BYTES = 16 * 1024 * 1024

function geminiHome(env: AdapterEnv): string {
  const explicit = env.env.GEMINI_CLI_HOME?.trim()
  return explicit ? join(explicit, '.gemini') : join(env.homeDir || homedir(), '.gemini')
}

/**
 * Which absolute directory a chat was recorded in.
 *
 * The recording does not say — this adapter reported no cwd at all for that reason, which put every
 * Gemini session in the statistics' "no working directory recorded" bucket. But Gemini keeps the answer beside the recordings: `~/.gemini/projects.json` maps ABSOLUTE PATH →
 * the short directory name under `tmp`, which is the name a chat is filed under. Inverting its own
 * file is not a guess.
 *
 * Two rules keep it from becoming one:
 *  - a short name that maps from more than one path resolves to NOTHING. Gemini derives the name
 *    from the last path segment, so two checkouts of the same repo would collide, and half-right
 *    attribution is worse here than none: `cwdPrefix` is a prefix filter, and a wrong prefix quietly
 *    moves sessions into another project's bar.
 *  - older recordings sit under a 64-hex directory instead. That is `sha256(absolutePath)` —
 *    verified with a synthetic fixture, where `5465db9e…` is the digest of
 *    `/Users/dev/Documents/sample-project`
 *    — so it is resolved by hashing the paths the map already lists, never by inverting a hash. A
 *    digest naming a path no longer in the map stays unresolved.
 */
async function projectPaths(env: AdapterEnv): Promise<Map<string, string>> {
  const base = geminiHome(env)
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
  const base = geminiHome(env)
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
  return summarizeGeminiDoc(doc, ref)
}

async function readTranscript(req: TranscriptRequest): Promise<TranscriptResult> {
  const doc = await loadDoc(req.ref.sourcePath)
  return transcriptFromGeminiDoc(doc, req)
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
  return turnStateFromGeminiDoc(doc, ref, now)
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
