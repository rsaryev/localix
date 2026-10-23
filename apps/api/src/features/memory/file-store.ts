import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { localixHome } from '../../lib/env'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { safeFileKey } from '@localixai/mini-app-sdk/backend'

/**
 * File-backed markdown memory store under `~/.localix/memories`. One file per
 * scope, user-editable by hand:
 *
 *   global   →  MEMORY.md
 *   project  →  projects/<projectId>.md
 *   session  →  sessions/<rootSessionId>.md
 *
 * (Non-default users are namespaced under `users/<userId>/...` — the single
 * local default user keeps the friendly top-level paths.)
 *
 * Entry format — tolerant of hand-edits (anything before the first `##` is
 * ignored, entries are trimmed):
 *
 *   ## <key>
 *   <!-- updated: <ISO timestamp> -->
 *   <value (multiline ok)>
 */

/** Hard char budget per memory file (global and project scopes). */
export const DEFAULT_MEMORY_CHAR_LIMIT = 2200
/** Smaller budget for ephemeral per-conversation scope. */
export const SESSION_MEMORY_CHAR_LIMIT = 1500

export interface MemoryFileEntry {
  key: string
  value: string
  /** ISO timestamp from the `<!-- updated: … -->` comment, if present. */
  updatedAt?: string
}

export interface MemoryUsage {
  chars: number
  limit: number
  /** Whole-number percentage of the limit used (rounded). */
  pct: number
}

/** Base directory for all memory files: `~/.localix/memories`. */
export function memoriesBaseDir(): string {
  return path.join(localixHome(), 'memories')
}

/**
 * Path of the markdown file backing one (user, scope) pair.
 * Scope: '' = global; 'session:<id>' = session; anything else = project id.
 *
 * Every segment below is a raw, untrusted id — `userId` is the unauthenticated `x-user-id`
 * request header (`app.ts`) — so each goes through `@localixai/mini-app-sdk/backend`, the ONE owner of
 * "untrusted key → filename". This used to hand-roll its own `safeFileSlug`, whose charset
 * admitted `.`: a `userId` of `..` survived it and made this very `path.join` collapse one
 * level OUT of `users/` and onto the DEFAULT user's `MEMORY.md`, and a `userId` of `.` landed
 * every such caller on one shared `users/MEMORY.md`. Both are pinned in the test beside this.
 */
export function memoryFilePath(
  baseDir: string,
  userId: string,
  scope: string,
  defaultUserId: string,
): string {
  const root = userId === defaultUserId ? baseDir : path.join(baseDir, 'users', safeFileKey(userId))
  if (!scope) return path.join(root, 'MEMORY.md')
  if (scope.startsWith('session:'))
    return path.join(root, 'sessions', `${safeFileKey(scope.slice('session:'.length))}.md`)
  return path.join(root, 'projects', `${safeFileKey(scope)}.md`)
}

/** Char budget for a scope: sessions get the smaller limit. */
export function charLimitForScope(scope: string): number {
  return scope.startsWith('session:') ? SESSION_MEMORY_CHAR_LIMIT : DEFAULT_MEMORY_CHAR_LIMIT
}

const UPDATED_COMMENT_RE = /^<!--\s*updated:\s*(.+?)\s*-->$/

/** Parse a memory markdown file. Tolerates hand-edits and unknown preamble. */
export function parseMemoryFile(text: string): MemoryFileEntry[] {
  const entries: MemoryFileEntry[] = []
  const seen = new Set<string>()
  // Split on `## ` headings at line start; ignore everything before the first one.
  const blocks = text.split(/^##[ \t]+/m).slice(1)
  for (const block of blocks) {
    const newline = block.indexOf('\n')
    const key = (newline === -1 ? block : block.slice(0, newline)).trim()
    if (!key || seen.has(key)) continue
    let body = newline === -1 ? '' : block.slice(newline + 1)
    let updatedAt: string | undefined
    const lines = body.split('\n')
    const firstNonEmpty = lines.findIndex((l) => l.trim() !== '')
    if (firstNonEmpty !== -1) {
      const match = UPDATED_COMMENT_RE.exec(lines[firstNonEmpty].trim())
      if (match) {
        updatedAt = match[1]
        lines.splice(firstNonEmpty, 1)
      }
    }
    body = lines.join('\n').trim()
    if (!body) continue
    seen.add(key)
    entries.push({ key, value: body, updatedAt })
  }
  return entries
}

/** Serialize entries back to the markdown file format. */
export function serializeMemoryFile(entries: MemoryFileEntry[]): string {
  if (entries.length === 0) return ''
  const blocks = entries.map((e) => {
    const updated = e.updatedAt ? `<!-- updated: ${e.updatedAt} -->\n` : ''
    return `## ${e.key}\n${updated}${e.value.trim()}`
  })
  return `${blocks.join('\n\n')}\n`
}

/**
 * Chars counted against the budget: the serialized entry content WITHOUT the
 * `updated` metadata comments (hand-editing timestamps shouldn't change budget).
 */
export function entriesChars(entries: MemoryFileEntry[]): number {
  if (entries.length === 0) return 0
  return entries.map((e) => `## ${e.key}\n${e.value.trim()}`).join('\n\n').length
}

export function usageOf(chars: number, limit: number): MemoryUsage {
  return { chars, limit, pct: limit > 0 ? Math.round((chars / limit) * 100) : 0 }
}

/** "82% — 1,804/2,200 chars" */
export function formatUsage(usage: MemoryUsage): string {
  const fmt = (n: number) => n.toLocaleString('en-US')
  return `${usage.pct}% — ${fmt(usage.chars)}/${fmt(usage.limit)} chars`
}

/** Read + parse a memory file; a missing file is an empty entry list. */
export async function readMemoryFile(filePath: string): Promise<MemoryFileEntry[]> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return parseMemoryFile(text)
}

/**
 * Serializes every mutation of a memory file, keyed by path — so a `write` and a
 * read-modify-write of the SAME scope never interleave. Both entry points below
 * share this one queue; that sharing is the whole point, and is why the
 * serializer is module-scoped rather than per-call.
 */
const serializeByPath = createKeyedSerializer()

/** Write entries atomically: temp file in the same dir, then rename over the target. */
async function atomicWrite(filePath: string, entries: MemoryFileEntry[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, serializeMemoryFile(entries), 'utf8')
  await rename(tmp, filePath)
}

/** Atomic write (temp file + rename), serialized per file path. */
export function writeMemoryFile(filePath: string, entries: MemoryFileEntry[]): Promise<void> {
  return serializeByPath(filePath, () => atomicWrite(filePath, entries))
}

/**
 * Read-modify-write a memory file as ONE unit on the per-path queue, so two
 * concurrent mutations to the same scope (e.g. a parent and a sub-agent both
 * writing `global`) can't each read the stale file and clobber each other's key —
 * the read happens INSIDE the queue, seeing the prior write's result. `fn`
 * transforms the current entries and may throw (e.g. a budget error) to abort the
 * write; returning `entries: null` skips the write (no spurious empty file when a
 * delete matched nothing). Returns whatever `fn` puts in `result`.
 */
export function mutateMemoryFile<T>(
  filePath: string,
  fn: (entries: MemoryFileEntry[]) => { entries: MemoryFileEntry[] | null; result: T },
): Promise<T> {
  return serializeByPath(filePath, async () => {
    const current = await readMemoryFile(filePath)
    const out = fn(current)
    if (out.entries !== null) await atomicWrite(filePath, out.entries)
    return out.result
  })
}
