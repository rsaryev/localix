import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'

import { createBoundedCache } from '../../../lib/bounded-cache'
import { ApiError } from '../../../lib/errors'
import { shellQuote, type ExecutionEnvironment } from '../../agent-core/tools/environment'
import { atomicWriteLocal } from './fs-mutations'
import { BINARY_DOC_MIME, BINARY_IMAGE_MIME } from './files'
import { tryListDirectory } from '../../agent-core/tools/file/read'
import {
  invalidateFileMtime,
  withPathLocks,
  workspaceLockPaths,
} from '../../agent-core/tools/file/file-utils'
import {
  openSessionEnv,
  resolveAgainst,
  contentHash,
  type FileOpsContext,
} from './file-ops-context'
import type { DirEntry, DirListing, FileContentResponse, FileWriteResponse } from '../contracts'

/**
 * Reading and writing a session's file CONTENT (the inspector viewer/editor) plus
 * listing a directory. Backend-agnostic via the session's execution environment;
 * writes are serialized against the agent's own tools by the shared per-path lock
 * and guarded by an optimistic-concurrency hash.
 */

// Read cap for the read-only viewer (keeps payloads small). The editor path asks
// for the full file (`full: true`) so a save can never write back a truncated
// buffer; we still bound that to avoid pulling a giant blob into the browser.
const VIEW_MAX_BYTES = 64_000
const EDIT_MAX_BYTES = 5_000_000

/** Max entries a single directory listing returns before it's capped (see {@link listDirectory}). */
const DIR_ENTRY_LIMIT = 1000
/** Bytes that always fit {@link DIR_ENTRY_LIMIT} far-side records: NAME_MAX + `./` + NUL each, plus the section separator. */
const REMOTE_LISTING_BYTE_BUDGET = DIR_ENTRY_LIMIT * (255 + 3) + 1
const LOCAL_TEXT_SNAPSHOT_LIMIT = 256

interface LocalFileIdentity {
  fingerprint: string
  bytes: number
}

interface LocalTextSnapshot extends LocalFileIdentity {
  hash: string
}

/**
 * Recently verified local text snapshots. A conditional editor revalidation can
 * compare the file's cheap kernel metadata with this identity before deciding to
 * read and SHA-256 the body again. The content hash remains the write-concurrency
 * token; metadata is only a read-avoidance hint, and any mismatch falls back to
 * the complete read.
 */
const localTextSnapshots = createBoundedCache<string, LocalTextSnapshot>({
  maxEntries: LOCAL_TEXT_SNAPSHOT_LIMIT,
})

async function localFileIdentity(
  resolved: string,
  signal?: AbortSignal,
): Promise<LocalFileIdentity | null> {
  try {
    signal?.throwIfAborted()
    const value = await stat(resolved, { bigint: true })
    signal?.throwIfAborted()
    if (!value.isFile()) return null
    return {
      // ctime closes the same-size + restored-mtime hole left by the common
      // mtime/size etag; inode/device also detect atomic replacement.
      fingerprint: [
        value.dev,
        value.ino,
        value.mode,
        value.size,
        value.mtimeNs,
        value.ctimeNs,
      ].join(':'),
      bytes: Number(value.size),
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

function rememberLocalTextSnapshot(
  resolved: string,
  identity: LocalFileIdentity,
  hash: string,
): void {
  localTextSnapshots.set(resolved, { ...identity, hash })
}

function knownLocalTextSnapshot(
  resolved: string,
  identity: LocalFileIdentity,
  knownHash: string,
): LocalTextSnapshot | null {
  // Peek first: only a snapshot that still matches counts as a use and is kept fresh.
  const snapshot = localTextSnapshots.peek(resolved)
  if (
    !snapshot ||
    snapshot.hash !== knownHash ||
    snapshot.fingerprint !== identity.fingerprint ||
    snapshot.bytes !== identity.bytes
  )
    return null
  localTextSnapshots.get(resolved)
  return snapshot
}

/**
 * Bound a far-side directory listing before it crosses SSH/Docker while retaining
 * the exact omitted count the Explorer contract renders.
 *
 * The listing is NUL-delimited because a filename may legally hold any byte but
 * `/` and NUL. The previous `ls -1Ap | awk` line protocol split a name containing
 * a newline into phantom rows, `.trim()`med away leading/trailing spaces (so the
 * row named a file that does not exist), let a file literally named `__NOT_DIR__`
 * blank its whole folder, and inherited `ls`'s locale and BSD/GNU differences.
 *
 * Only POSIX-portable pieces are used, so GNU, BSD (macOS) and busybox hosts all
 * answer the same: `find -mindepth/-maxdepth/-print0/-type d` (not GNU-only
 * `-printf`), `tr -cd '\000'` to count records, `head -c` to bound transport.
 * The directory kind comes from running `-type d` and `! -type d` as two passes
 * separated by one EMPTY record — a real record is never empty, since each starts
 * with `./`. `find` does not follow symlinks, so a link to a folder lists as a
 * file, exactly like the local `readdir` branch of {@link listDirectory}.
 *
 * Output: the total entry count on the first line, then the records. Bytes are
 * capped at enough for {@link DIR_ENTRY_LIMIT} records of the longest legal name
 * (NAME_MAX 255 + `./` + NUL); a record cut by the cap has no terminating NUL and
 * is dropped. Which entries of a >1000-entry folder make the cut follows the
 * directory's own order (dirs first) rather than a sorted one — `sort -z` is not
 * portable — and the shown rows are sorted by the caller either way.
 */
export async function listRemoteDirectory(
  env: ExecutionEnvironment,
  target: string,
): Promise<{ entries: DirEntry[]; total: number } | null> {
  const level = '. -mindepth 1 -maxdepth 1'
  const command =
    `command -v find >/dev/null 2>&1 || exit 4; ` +
    `[ -d ${shellQuote(target)} ] && cd -- ${shellQuote(target)} || exit 3; ` +
    `n=$(find ${level} -print0 2>/dev/null | tr -cd '\\000' | wc -c); ` +
    `printf '%s\\n' $n; ` +
    `{ find ${level} -type d -print0; printf '\\000'; find ${level} ! -type d -print0; } 2>/dev/null ` +
    `| head -c ${REMOTE_LISTING_BYTE_BUDGET}`
  const res = await env.exec(command)
  if (res.exitCode !== 0) return null

  const newline = res.stdout.indexOf('\n')
  if (newline < 0) return null
  const counted = Number(res.stdout.slice(0, newline).trim())
  if (!Number.isSafeInteger(counted) || counted < 0) return null

  const records = res.stdout.slice(newline + 1).split('\0')
  // The final piece is '' after a complete stream, or a record the byte cap cut.
  records.pop()
  const entries: DirEntry[] = []
  let type: DirEntry['type'] = 'dir'
  for (const record of records) {
    if (record === '') {
      type = 'file'
      continue
    }
    if (entries.length >= DIR_ENTRY_LIMIT) break
    if (!record.startsWith('./')) return null
    entries.push({ name: record.slice(2), type })
  }
  // The count and the listing are two reads of a live folder; never report fewer
  // entries than were shown.
  return { entries, total: Math.max(counted, entries.length) }
}

export async function readFile(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  filePath: string,
  opts?: { full?: boolean; knownHash?: string; signal?: AbortSignal },
): Promise<FileContentResponse> {
  const { env, dir } = await openSessionEnv(ctx, userId, sessionId)
  const resolved = resolveAgainst(dir, filePath)
  const MAX_BYTES = opts?.full ? EDIT_MAX_BYTES : VIEW_MAX_BYTES

  // Binary images (png/jpg/gif/webp/…) AND binary documents (pdf/docx/xlsx/pptx/odt)
  // can't survive a UTF-8 read — a NUL-byte sniff garbles them — so fetch their raw
  // bytes as base64 via the environment and hand the UI a typed blob it can render or
  // hand to a registered document viewer or extractor.
  const ext = path.extname(resolved).toLowerCase()
  const binaryMime = BINARY_IMAGE_MIME[ext] ?? BINARY_DOC_MIME[ext]
  if (binaryMime) {
    // Documents can be larger than an inline image (a 30MB PDF), so allow a bigger cap.
    const MAX_BINARY_BYTES = BINARY_DOC_MIME[ext] ? 30_000_000 : 10_000_000
    const q = shellQuote(resolved)
    // Size first, in the SAME round trip, for two reasons. (1) The oversize refusal
    // has to happen before the bytes are read, not after — `uncapped` below removes
    // the capture ceiling, so a huge file would otherwise be pulled into memory in
    // full just to be rejected. (2) It gives the exact byte count; deriving it from
    // the base64 length is off by up to two bytes of padding.
    // `uncapped`: a binary's base64 must round-trip INTACT. Without it the default
    // ~2 MB stdout cap keeps only the TAIL, which drops the leading bytes and hands
    // the viewer undecodable base64 — a 4 MB PNG came back as 2.3 MB of garbage.
    // The agent's own view_image path passes it for exactly this reason.
    const res = await env.exec(
      `n=$(wc -c < ${q}) || exit 1; ` +
        `if [ "$n" -gt ${MAX_BINARY_BYTES} ]; then printf 'TOOBIG %s' "$n"; ` +
        `else printf 'OK %s\\n' "$n"; base64 < ${q}; fi`,
      { uncapped: true, signal: opts?.signal },
    )
    if (res.exitCode !== 0) {
      throw new ApiError(404, 'file_not_found', `Cannot read ${resolved}`)
    }
    const header = res.stdout.slice(0, res.stdout.indexOf('\n') + 1 || res.stdout.length)
    // Split on a RUN of whitespace: BSD `wc -c` pads its count ("  4000000"), and the
    // assignment keeps that padding, so the header can carry more than one space.
    const byteLength = Number(header.trim().split(/\s+/)[1])
    if (header.startsWith('TOOBIG')) {
      return {
        path: resolved,
        content: '',
        bytes: byteLength,
        truncated: true,
        mimeType: binaryMime,
        encoding: 'base64',
      }
    }
    return {
      path: resolved,
      content: res.stdout.slice(header.length).replace(/\s+/g, ''),
      bytes: byteLength,
      truncated: false,
      mimeType: binaryMime,
      encoding: 'base64',
    }
  }

  const isSvg = path.extname(resolved).toLowerCase() === '.svg'
  const localBefore =
    env.config.kind === 'local' ? await localFileIdentity(resolved, opts?.signal) : null
  if (localBefore && localBefore.bytes <= MAX_BYTES && opts?.knownHash) {
    const snapshot = knownLocalTextSnapshot(resolved, localBefore, opts.knownHash)
    if (snapshot) {
      return {
        path: resolved,
        content: '',
        bytes: snapshot.bytes,
        truncated: false,
        hash: snapshot.hash,
        unchanged: true,
        ...(isSvg ? { mimeType: 'image/svg+xml', encoding: 'utf8' as const } : {}),
      }
    }
  }

  let content: string
  try {
    content = await env.readFile(resolved, opts?.signal)
    opts?.signal?.throwIfAborted()
    // Some platforms read a directory as an empty string — list it instead.
    // A successful local stat already proved an empty regular file is not one,
    // avoiding a shell directory probe every time an empty editor opens.
    if (content === '' && !localBefore) {
      const listing = await tryListDirectory(env, resolved)
      opts?.signal?.throwIfAborted()
      if (listing !== null) content = listing
    }
  } catch (error) {
    // Cancellation is terminal. Falling through to the directory probe here would
    // turn one retired file-open request into a fresh shell command after its
    // caller has already gone away.
    if (opts?.signal?.aborted) throw error
    const listing = await tryListDirectory(env, resolved)
    opts?.signal?.throwIfAborted()
    if (listing === null) throw new ApiError(404, 'file_not_found', `Cannot read ${resolved}`)
    content = listing
  }
  opts?.signal?.throwIfAborted()

  const buffer = Buffer.from(content)
  const truncated = buffer.byteLength > MAX_BYTES
  const hash = truncated ? undefined : contentHash(content)

  if (hash && localBefore) {
    const localAfter = await localFileIdentity(resolved, opts?.signal)
    if (
      localAfter &&
      localAfter.fingerprint === localBefore.fingerprint &&
      localAfter.bytes === buffer.byteLength
    )
      rememberLocalTextSnapshot(resolved, localAfter, hash)
  }

  // Conditional read. The open editor reconciles against disk on every coarse
  // FS-watch frame touching its directory and on every visibility resume; almost
  // every one of those finds the file untouched. When the caller already holds the
  // current hash, answer with the token alone and leave the body off the wire.
  // (Truncated reads carry no hash, so they can never take this branch.)
  if (hash && opts?.knownHash) {
    if (hash === opts.knownHash) {
      return {
        path: resolved,
        content: '',
        bytes: buffer.byteLength,
        truncated: false,
        hash,
        unchanged: true,
        ...(isSvg ? { mimeType: 'image/svg+xml', encoding: 'utf8' as const } : {}),
      }
    }
  }

  return {
    path: resolved,
    content: truncated
      ? `${buffer.subarray(0, MAX_BYTES).toString('utf8')}\n[…truncated…]`
      : content,
    bytes: buffer.byteLength,
    truncated,
    // The editor's optimistic-concurrency token: a save echoes this back and the
    // server rejects (409) if the file changed on disk meanwhile. Only meaningful
    // for a complete read — a truncated buffer must never be saved.
    ...(hash ? { hash } : {}),
    ...(isSvg ? { mimeType: 'image/svg+xml', encoding: 'utf8' as const } : {}),
  }
}

/**
 * Save full UTF-8 content from the inspector editor. Backend-agnostic (local/ssh/
 * docker) via `ExecutionEnvironment.writeFile`. Optimistic concurrency: the client
 * sends the `baseHash` it loaded; if the file changed on disk since (agent edit,
 * external formatter), we refuse with 409 so a human save never silently clobbers.
 * Serialized against the agent's write/edit tools through the shared per-path lock.
 */
export async function writeFile(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  filePath: string,
  content: string,
  baseHash: string,
): Promise<FileWriteResponse> {
  const { env, dir } = await openSessionEnv(ctx, userId, sessionId)
  const resolved = resolveAgainst(dir, filePath)

  return withPathLocks(workspaceLockPaths(dir, [resolved]), () =>
    writeResolvedFileUnderLock(env, resolved, content, baseHash),
  )
}

/**
 * The concurrency-checked write body for callers that ALREADY hold `resolved`'s
 * shared path lock. Keeping the lock acquisition outside makes a multi-file edit
 * able to hold every target lock together without deadlocking by reacquiring one.
 */
export async function writeResolvedFileUnderLock(
  env: ExecutionEnvironment,
  resolved: string,
  content: string,
  baseHash: string,
): Promise<FileWriteResponse> {
  // Optimistic-concurrency check against the live on-disk content.
  let current = ''
  try {
    current = await env.readFile(resolved)
  } catch {
    // New file (never existed) — allowed only when the client also had none.
    current = ''
  }
  if (contentHash(current) !== baseHash) {
    throw new ApiError(
      409,
      'file_conflict',
      `${resolved} changed on disk since it was opened. Reload before saving.`,
    )
  }

  // Atomic write on the local backend (temp sibling + rename) so an interrupted
  // save never leaves a half-written file; ssh/docker fall back to the generic
  // environment writeFile.
  if (env.config.kind === 'local') await atomicWriteLocal(resolved, content)
  else await env.writeFile(resolved, content)
  // The user saved this file from the editor — no agent tool observed the new
  // content. Forget the path in every session's store rather than recording the
  // new mtime: `write` must then refuse the blind overwrite (handing the current
  // content back) and `apply_patch` must match against what is really on disk.
  invalidateFileMtime(resolved)

  return {
    path: resolved,
    bytes: Buffer.byteLength(content, 'utf8'),
    hash: contentHash(content),
  }
}

export async function listDirectory(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  dirPath?: string,
): Promise<DirListing> {
  const { env, dir: root } = await openSessionEnv(ctx, userId, sessionId)
  const target = !dirPath ? root : resolveAgainst(root, dirPath)

  let unsortedEntries: DirEntry[]
  let totalEntries: number
  if (env.config.kind === 'local') {
    // Explorer refresh is latency-sensitive and can read several expanded folders
    // after one filesystem frame. A local listing must stay in-process: spawning a
    // login shell + `ls` per folder measured 12–91x slower than native readdir and
    // also split legal filenames containing newlines into phantom tree rows.
    try {
      unsortedEntries = (await readdir(target, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? ('dir' as const) : ('file' as const),
      }))
      totalEntries = unsortedEntries.length
    } catch {
      throw new ApiError(404, 'not_a_directory', `${target} is not a directory`)
    }
  } else {
    const remote = await listRemoteDirectory(env, target)
    if (!remote) {
      throw new ApiError(404, 'not_a_directory', `${target} is not a directory`)
    }
    unsortedEntries = remote.entries
    totalEntries = remote.total
  }

  const allEntries = unsortedEntries.sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
  )

  // Cap huge directories (e.g. `.turbo/cache`, `node_modules` with tens of
  // thousands of entries) so a single expand can't ship — or make the tree
  // render — an unbounded row list and freeze the UI. Dirs sort first, so the
  // cap keeps the most navigable entries; the omitted count rides `truncated`.
  const overflow = totalEntries - DIR_ENTRY_LIMIT
  const entries = overflow > 0 ? allEntries.slice(0, DIR_ENTRY_LIMIT) : allEntries

  return { path: target, entries, ...(overflow > 0 ? { truncated: overflow } : {}) }
}
