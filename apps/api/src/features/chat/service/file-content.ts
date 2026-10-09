import path from 'node:path'

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
import type { FileContentResponse, FileWriteResponse } from '../contracts'

import {
  localFileIdentity,
  rememberLocalTextSnapshot,
  knownLocalTextSnapshot,
} from './local-text-snapshots'

export { listDirectory, listRemoteDirectory } from './directory-listing'

/**
 * Reading and writing a session's file CONTENT (the inspector viewer/editor).
 * Directory listing is re-exported from directory-listing.ts. Content operations
 * use the session's execution environment;
 * writes are serialized against the agent's own tools by the shared per-path lock
 * and guarded by an optimistic-concurrency hash.
 */

// Read cap for the read-only viewer (keeps payloads small). The editor path asks
// for the full file (`full: true`) so a save can never write back a truncated
// buffer; we still bound that to avoid pulling a giant blob into the browser.
const VIEW_MAX_BYTES = 64_000
const EDIT_MAX_BYTES = 5_000_000

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
