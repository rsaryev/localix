/**
 * WHERE a collection lives, and what a request inside it is CALLED.
 *
 * The store is a directory of JSON files under the workspace's ignored `.localix/` data folder,
 * not a global blob under the user's home directory. The host resolves `cwd` to the session's
 * workspace before this module is called, so the root does not repeat the session id.
 * A file-and-folder model fits: each request is readable, portable JSON and the directory tree is
 * the collection. Sharing with git is a separate, explicit export action.
 *
 * IDENTITY IS THE PATH. A request is named `users/list`, and that name IS its location:
 * `<root>/users/list.request.json`. Folders are ordinary directories rather than records or index
 * entries. They may stay empty so the workbench can create a collection structure before requests
 * are added; the filesystem remains the only source of truth.
 *
 * The `.request.json` suffix is not in the name. It is deliberately compound, like
 * `.board.json`: editors and the OS can recognise a Localix request without treating every JSON
 * document as one.
 *
 * TRAVERSAL. A name arrives from a user's rename box or from a model's tool call, so `../../etc`
 * and `/etc/passwd` are inputs this module must expect rather than trust. Containment is delegated
 * to `@localixai/path-containment` — the repo's one owner of that question, whose own tests
 * enumerate the ways a naive `startsWith` gets it wrong — and never re-derived here.
 */

import path from 'node:path'
import { isPathBelow, resolveWithin } from '@localixai/path-containment'

/** The API data root inside the already-resolved session workspace. */
export const COLLECTION_DIR = path.join('.localix', 'api')

/** One request per file; the tree IS the folder structure. */
export const REQUEST_EXT = '.request.json'
/** Read-only compatibility for files written before the compound suffix was introduced. */
export const LEGACY_REQUEST_EXT = '.json'

/**
 * Segments a name may not use, whatever the filesystem would tolerate.
 *
 * `.` and `..` are traversal; a leading dot hides the file from a plain `ls` and from most
 * file browsers, which for a request meant to be found is a trap rather than a feature. Everything
 * else is left to the filesystem: this is a workspace file, and a name that
 * works in the user's editor should work here.
 */
function segmentIsLegal(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.startsWith('.')
}

/** Normalize a collection folder without applying request-file suffix rules. */
export function normalizeFolderName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/')
  const segments = trimmed.split('/').filter((segment) => segment !== '')
  if (segments.length === 0 || !segments.every(segmentIsLegal)) return null
  return segments.join('/')
}

/** Absolute path for a real collection folder, contained below the collection root. */
export function collectionFolderPath(root: string, name: string): string | null {
  const normalized = normalizeFolderName(name)
  return normalized ? resolveWithin(root, normalized) : null
}

/**
 * Normalize a request name to its canonical form, or `null` when it is not a name we can store.
 *
 * Canonical means: forward slashes, no leading/trailing separator, no empty or dotted segment, no
 * request suffix. `Users//List/` and `users/list` are the same request; `../x` is not a request.
 */
export function normalizeRequestName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/')
  const withoutExt = trimmed.endsWith(REQUEST_EXT)
    ? trimmed.slice(0, -REQUEST_EXT.length)
    : trimmed.endsWith(LEGACY_REQUEST_EXT)
      ? trimmed.slice(0, -LEGACY_REQUEST_EXT.length)
      : trimmed
  const segments = withoutExt.split('/').filter((s) => s !== '')
  if (segments.length === 0 || !segments.every(segmentIsLegal)) return null
  return segments.join('/')
}

/** The folder part of a name, or `''` for a request at the collection root. */
export function folderOf(name: string): string {
  const at = name.lastIndexOf('/')
  return at === -1 ? '' : name.slice(0, at)
}

/** The last segment — what a tree shows on the row. */
export function leafOf(name: string): string {
  const at = name.lastIndexOf('/')
  return at === -1 ? name : name.slice(at + 1)
}

/**
 * Absolute file path for a request name under `root`, or `null` when the name escapes it.
 *
 * Both halves matter. `normalizeRequestName` rejects the names we can reason about; `resolveWithin`
 * catches whatever it did not think of — a symlinked segment, a Windows device path, a unicode
 * separator the split above never saw as one. Belt and braces, on the boundary where a crafted name
 * would otherwise write anywhere the process can reach.
 */
export function requestFilePath(root: string, name: string): string | null {
  const normalized = normalizeRequestName(name)
  if (normalized === null) return null
  return resolveWithin(root, `${normalized}${REQUEST_EXT}`)
}

/** The pre-migration path for one request. Never used for new writes. */
export function legacyRequestFilePath(root: string, name: string): string | null {
  const normalized = normalizeRequestName(name)
  if (normalized === null) return null
  return resolveWithin(root, `${normalized}${LEGACY_REQUEST_EXT}`)
}

/** The name a file path under `root` stands for, or `null` when it is not one of ours. */
export function requestNameFor(root: string, absolutePath: string): string | null {
  if (!isPathBelow(root, absolutePath)) return null
  const relative = path.relative(root, absolutePath)
  const suffix = relative.endsWith(REQUEST_EXT)
    ? REQUEST_EXT
    : relative.endsWith(LEGACY_REQUEST_EXT)
      ? LEGACY_REQUEST_EXT
      : null
  if (!suffix) return null
  return normalizeRequestName(relative.slice(0, -suffix.length))
}
