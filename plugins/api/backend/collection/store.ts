/**
 * The collection store: a directory of request files in the workspace.
 *
 * It replaces a global per-user blob. A global pile follows you between projects and sessions, so
 * the requests for the service you are working on sit beside unrelated requests from another
 * conversation. The scoped root supplied by `for-scope.ts` fixes that while keeping one readable
 * JSON file per request.
 *
 * ONE FILE PER REQUEST, and it is the SAME file `git-sync/format.ts` already writes — that module
 * was built for portable request JSON. A literal credential is REFUSED, never redacted, because a
 * local request file must not become a secret store and a silently-redacted request is one that no
 * longer works. `${secret:KEY}` writes freely, which is the whole argument for references made
 * concrete.
 *
 * NO INDEX FILE. The directory IS the index: `list()` walks it. An index would be a second source
 * of truth that a rename or edit could contradict — and the failure mode of a stale index is a
 * request that exists but cannot be found.
 * The cost is a directory walk per list, over a tree measured in dozens of small files.
 *
 * CONCURRENCY is the filesystem's, not ours. A write is atomic (`atomicWriteFile`), so a reader
 * never sees half a file, and two writers to the same request are last-write-wins — the same
 * semantics the user's own editor has, in a directory they own.
 */

import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import { atomicWriteFile } from '@localixai/plugin-sdk/backend'
import type { RequestSpec } from '../request-spec'
import { buildRequestFile, gitSafetyProblem, parseRequestFile } from '../git-sync/format'
import { ENVIRONMENTS_DIR } from './environments'
import {
  collectionFolderPath,
  LEGACY_REQUEST_EXT,
  normalizeFolderName,
  REQUEST_EXT,
  legacyRequestFilePath,
  normalizeRequestName,
  requestFilePath,
  requestNameFor,
} from './paths'

export interface CollectionRequest {
  /** The name, which is also the path inside the collection: `users/list`. */
  name: string
  spec: RequestSpec
  /**
   * Filesystem timestamps. The file IS the record, so these are its `birthtime`/`mtime` rather
   * than fields inside it — a stamp written into the JSON would be one more thing a `git pull`
   * or an edit in the user's own editor could make wrong, and neither is worth a merge conflict.
   */
  createdAt: number
  updatedAt: number
}

export type SaveOutcome = { ok: true; request: CollectionRequest } | { ok: false; problem: string }

export interface CollectionStore {
  /** Every request in the collection, sorted by name so the tree is stable. */
  list(): Promise<CollectionRequest[]>
  get(name: string): Promise<CollectionRequest | null>
  /** Write a request. Refuses a literal credential and an unstorable name. */
  save(name: string, spec: RequestSpec): Promise<SaveOutcome>
  /** Remove it. Its directory remains as a user-visible collection folder. */
  remove(name: string): Promise<boolean>
  /** Move a request, keeping its content. Refuses when the target name is taken. */
  rename(from: string, to: string): Promise<SaveOutcome>
  /** Real directories, including empty ones, for the collection navigator. */
  listFolders?(): Promise<string[]>
  createFolder?(name: string): Promise<{ ok: true; name: string } | { ok: false; problem: string }>
  /** Only an empty directory can be removed; request deletion is always explicit. */
  removeFolder?(name: string): Promise<{ ok: true } | { ok: false; problem: string }>
  /** The absolute directory this collection lives in — for messages that name a path. */
  root(): string
}

/** Depth cap for the walk: a collection is a human-maintained tree, not a filesystem. */
const MAX_DEPTH = 8

async function walk(dir: string, root: string, depth: number): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  // `encoding: 'utf8'` rides along so the entries carry STRING names: the plain
  // `withFileTypes: true` overload types them as buffers under this tsconfig, and a buffer has
  // no `.startsWith`.
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return [] // no collection yet, or unreadable — an empty collection, not a crash
  }
  const found: string[] = []
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    // A dot-directory is not part of the collection (see `paths.ts` on hidden segments), and
    // skipping it here keeps a stray `.git` or `.DS_Store` out of the walk entirely.
    if (entry.name.startsWith('.')) continue
    // `environments/` at the ROOT is the reserved folder those live in (see
    // collection/environments.ts). Nested, the name is an ordinary folder — the reservation is
    // one level deep, so `users/environments/list` stays a perfectly good request.
    if (depth === 0 && entry.isDirectory() && entry.name === ENVIRONMENTS_DIR) continue
    if (entry.isDirectory()) found.push(...(await walk(absolute, root, depth + 1)))
    else if (
      entry.isFile() &&
      (entry.name.endsWith(REQUEST_EXT) || entry.name.endsWith(LEGACY_REQUEST_EXT))
    ) {
      found.push(absolute)
    }
  }
  return found
}

async function walkFolders(dir: string, root: string, depth: number): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (depth === 0 && entry.name === ENVIRONMENTS_DIR) continue
    const absolute = path.join(dir, entry.name)
    const relative = path.relative(root, absolute).split(path.sep).join('/')
    found.push(relative, ...(await walkFolders(absolute, root, depth + 1)))
  }
  return found
}

export function createCollectionStore(root: string): CollectionStore {
  const read = async (file: string): Promise<CollectionRequest | null> => {
    const name = requestNameFor(root, file)
    if (name === null) return null
    try {
      const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      const parsed = parseRequestFile(text)
      if (!parsed) return null
      // The NAME comes from the path, not from the file's own `name` field. They can disagree —
      // a colleague renamed the file, or the user did it in their editor — and the path is the
      // one the tree, the URIs and the history key already agree on.
      return { name, spec: parsed.spec, createdAt: info.birthtimeMs, updatedAt: info.mtimeMs }
    } catch {
      return null // unreadable or malformed — absent rather than fatal for the whole list
    }
  }

  /**
   * Move a valid legacy `<name>.json` to the typed `<name>.request.json` path. A canonical file
   * always wins a collision; the legacy file is left untouched rather than risking data loss.
   */
  const migrateLegacy = async (
    legacyFile: string,
    parsed?: CollectionRequest | null,
  ): Promise<CollectionRequest | null> => {
    const legacy = parsed ?? (await read(legacyFile))
    if (!legacy || legacyFile.endsWith(REQUEST_EXT)) return legacy
    const canonical = requestFilePath(root, legacy.name)
    if (!canonical) return legacy
    try {
      await stat(canonical)
      return (await read(canonical)) ?? legacy
    } catch {
      // Missing is the expected migration case. `rename` is atomic on this collection filesystem.
    }
    try {
      await mkdir(path.dirname(canonical), { recursive: true })
      await rename(legacyFile, canonical)
      return read(canonical)
    } catch {
      // Another process may have completed the same migration between stat and rename.
      return (await read(canonical)) ?? legacy
    }
  }

  return {
    root: () => root,

    async list() {
      const files = await walk(root, root, 0)
      const canonicalByName = new Map<string, string>()
      const legacyByName = new Map<string, string>()
      for (const file of files) {
        const name = requestNameFor(root, file)
        if (!name) continue
        if (file.endsWith(REQUEST_EXT)) canonicalByName.set(name, file)
        else legacyByName.set(name, file)
      }
      const names = new Set([...canonicalByName.keys(), ...legacyByName.keys()])
      const found = await Promise.all(
        [...names].map(async (name) => {
          const canonical = canonicalByName.get(name)
          const legacy = legacyByName.get(name)
          if (canonical) {
            const preferred = await read(canonical)
            return preferred ?? (legacy ? read(legacy) : null)
          }
          return legacy ? migrateLegacy(legacy) : null
        }),
      )
      return found
        .filter((request): request is CollectionRequest => request !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    async listFolders() {
      return (await walkFolders(root, root, 0)).sort((a, b) => a.localeCompare(b))
    },

    async createFolder(name) {
      const normalized = normalizeFolderName(name)
      const folder = normalized ? collectionFolderPath(root, normalized) : null
      if (!normalized || !folder) {
        return { ok: false, problem: `"${name}" is not a usable folder name.` }
      }
      if (isAtOrUnder(`/${ENVIRONMENTS_DIR}`, `/${normalized}`)) {
        return { ok: false, problem: `"${ENVIRONMENTS_DIR}/" is reserved for environments.` }
      }
      try {
        await mkdir(folder, { recursive: true })
        return { ok: true, name: normalized }
      } catch (error) {
        return {
          ok: false,
          problem: error instanceof Error ? error.message : `Could not create "${normalized}".`,
        }
      }
    },

    async removeFolder(name) {
      const normalized = normalizeFolderName(name)
      const folder = normalized ? collectionFolderPath(root, normalized) : null
      if (!normalized || !folder || isAtOrUnder(`/${ENVIRONMENTS_DIR}`, `/${normalized}`)) {
        return { ok: false, problem: `"${name}" is not a usable collection folder.` }
      }
      try {
        // `rmdir` is deliberately non-recursive: a folder containing requests can never be erased
        // through the folder action, even if the UI or a caller made a bad assumption.
        await rmdir(folder)
        return { ok: true }
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : ''
        return {
          ok: false,
          problem:
            code === 'ENOTEMPTY'
              ? `Folder "${normalized}" is not empty. Move or delete its requests first.`
              : code === 'ENOENT'
                ? `No folder named "${normalized}".`
                : error instanceof Error
                  ? error.message
                  : `Could not delete "${normalized}".`,
        }
      }
    },

    async get(name) {
      const file = requestFilePath(root, name)
      if (file === null) return null
      const canonical = await read(file)
      if (canonical) return canonical
      const legacy = legacyRequestFilePath(root, name)
      return legacy ? migrateLegacy(legacy) : null
    },

    async save(name, spec) {
      const normalized = normalizeRequestName(name)
      const file = normalized === null ? null : requestFilePath(root, normalized)
      if (normalized === null || file === null) {
        return {
          ok: false,
          problem: `"${name}" is not a usable request name. Use letters, digits and \`/\` for folders, e.g. \`users/list\`.`,
        }
      }
      // The reserved folder, refused explicitly rather than allowed to write a file that reads
      // as both an environment and a request.
      if (isAtOrUnder(`/${ENVIRONMENTS_DIR}`, `/${normalized}`)) {
        return {
          ok: false,
          problem: `"${ENVIRONMENTS_DIR}/" is reserved for this collection's environments. Name the request something else.`,
        }
      }
      // Reuse the export format's credential detector, but report the session-store rule rather
      // than its git-specific wording. Checked BEFORE the write, so a refused save changes nothing.
      const refusal = gitSafetyProblem(normalized, spec)
      if (refusal) {
        return {
          ok: false,
          problem:
            `"${normalized}" contains a literal credential, so it was NOT saved. ` +
            'Session request JSON stores vault references only; move the value into the vault and use `${secret:KEY}`.',
        }
      }

      await mkdir(path.dirname(file), { recursive: true })
      await atomicWriteFile(
        file,
        `${JSON.stringify(buildRequestFile(normalized, spec), null, 2)}\n`,
      )
      const legacy = legacyRequestFilePath(root, normalized)
      if (legacy && legacy !== file) await rm(legacy, { force: true }).catch(() => undefined)
      const saved = await read(file)
      return saved
        ? { ok: true, request: saved }
        : { ok: false, problem: `"${normalized}" was written but could not be read back.` }
    },

    async remove(name) {
      const file = requestFilePath(root, name)
      if (file === null) return false
      const legacy = legacyRequestFilePath(root, name)
      let removed = false
      for (const candidate of [file, legacy].filter((value): value is string => Boolean(value))) {
        try {
          await rm(candidate)
          removed = true
        } catch {
          // Absent is not an error; the other suffix may still exist.
        }
      }
      if (!removed) return false
      // Keep the directory visible as an empty collection folder. It can be removed explicitly;
      // silently pruning it made a user-created folder disappear with its last request.
      return true
    },

    async rename(from, to) {
      const existing = await this.get(from)
      if (!existing) return { ok: false, problem: `No saved request named "${from}".` }
      const normalized = normalizeRequestName(to)
      if (normalized === null) {
        return { ok: false, problem: `"${to}" is not a usable request name.` }
      }
      if (normalized !== existing.name && (await this.get(normalized))) {
        return { ok: false, problem: `A request named "${normalized}" already exists.` }
      }
      const saved = await this.save(normalized, existing.spec)
      if (!saved.ok || normalized === existing.name) return saved
      await this.remove(existing.name)
      return saved
    },
  }
}
