/**
 * Environments as files, beside the requests they render.
 *
 * An environment says WHERE a request points (`base_url`, `api_version`, an account id) and it is
 * part of the same shared artefact: pull the repo, get the team's `staging`. So it lives in the
 * collection — `.localix/api/environments/<name>.json` — one file per environment, inside the
 * collection folder.
 *
 * `environments/` is therefore RESERVED at the collection root. A request cannot be named
 * `environments/…`, which is a real if small restriction, and it is refused explicitly rather than
 * allowed to produce a file that reads as both things. The request walk skips this folder.
 *
 * WHICH ONE IS ACTIVE IS NOT IN THESE FILES, and that is the decision this module turns on. Active
 * is one person's current target, not a property of the environment: committing it would mean a
 * colleague's `git pull` silently re-points your next send at their deployment, and a branch merge
 * would decide it by conflict resolution. So the pointer lives in the plugin's own state directory,
 * keyed by collection root, and the files stay pure.
 *
 * Secret values never live here. A variable marked `secret` stores only a `${secret:KEY}` pointer;
 * the value itself lives in Localix's native vault and is resolved only for the outgoing wire
 * request. Variables and secrets are shown separately, and secrets use the host capability instead
 * of a plugin-private secret database.
 */

import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import { resolveWithin } from '@localixai/path-containment'
import type { Pair } from '../request-spec'

export interface EnvironmentVariable extends Pair {
  /** The value is empty or a native-vault `${secret:KEY}` reference, never a literal on disk. */
  secret?: boolean
}

/** The one folder name a request may not use. Skipped by the request walk. */
export const ENVIRONMENTS_DIR = 'environments'

const ENV_EXT = '.json'
/** Bumped only when an older file would be read WRONG, never for an additive field. */
export const ENVIRONMENT_FILE_VERSION = 1

export interface EnvironmentFile {
  localixApiEnvironment: typeof ENVIRONMENT_FILE_VERSION
  name: string
  variables: EnvironmentVariable[]
}

export interface StoredEnvironment {
  name: string
  variables: EnvironmentVariable[]
  createdAt: number
  updatedAt: number
}

export type EnvironmentSaveOutcome =
  | { ok: true; environment: StoredEnvironment }
  | { ok: false; problem: string }

export interface FileEnvironmentStore {
  list(): Promise<StoredEnvironment[]>
  get(name: string): Promise<StoredEnvironment | null>
  save(name: string, variables: EnvironmentVariable[]): Promise<EnvironmentSaveOutcome>
  remove(name: string): Promise<boolean>
  /** Move an environment file without resolving or rewriting any Vault references. */
  rename(from: string, to: string): Promise<EnvironmentSaveOutcome>
  /** The absolute folder these live in. */
  root(): string
}

/**
 * An environment name is ONE segment — no folders. Environments are a flat, short list a person
 * picks from, and a `staging/eu` that reads as a folder in one place and a name in another is a
 * distinction with no payoff.
 */
export function normalizeEnvironmentName(raw: string): string | null {
  const name = raw.trim()
  if (name === '' || name.includes('/') || name.includes('\\')) return null
  if (name === '.' || name === '..' || name.startsWith('.')) return null
  return name
}

export function parseEnvironmentFile(text: string): EnvironmentFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const file = parsed as Partial<EnvironmentFile>
  if (file.localixApiEnvironment !== ENVIRONMENT_FILE_VERSION) return null
  if (typeof file.name !== 'string' || !Array.isArray(file.variables)) return null
  return {
    localixApiEnvironment: ENVIRONMENT_FILE_VERSION,
    name: file.name,
    variables: file.variables,
  }
}

export function createFileEnvironmentStore(collectionRoot: string): FileEnvironmentStore {
  const root = path.join(collectionRoot, ENVIRONMENTS_DIR)

  const fileFor = (name: string): string | null => {
    const normalized = normalizeEnvironmentName(name)
    return normalized === null ? null : resolveWithin(root, `${normalized}${ENV_EXT}`)
  }

  const read = async (file: string): Promise<StoredEnvironment | null> => {
    try {
      const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      const parsed = parseEnvironmentFile(text)
      if (!parsed) return null
      // The NAME is the file's, like a request's — a rename in the user's editor is a rename.
      return {
        name: path.basename(file, ENV_EXT),
        variables: parsed.variables,
        createdAt: info.birthtimeMs,
        updatedAt: info.mtimeMs,
      }
    } catch {
      return null
    }
  }

  return {
    root: () => root,

    async list() {
      let entries: Dirent[]
      try {
        entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' })
      } catch {
        return []
      }
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith(ENV_EXT) && !e.name.startsWith('.'))
        .map((e) => path.join(root, e.name))
      const found = await Promise.all(files.map(read))
      return found
        .filter((e): e is StoredEnvironment => e !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    async get(name) {
      const file = fileFor(name)
      return file === null ? null : read(file)
    },

    async save(name, variables) {
      const normalized = normalizeEnvironmentName(name)
      const file = normalized === null ? null : fileFor(normalized)
      if (normalized === null || file === null) {
        return {
          ok: false,
          problem: `"${name}" is not a usable environment name. Use one segment, e.g. \`staging\`.`,
        }
      }
      await mkdir(root, { recursive: true })
      const body: EnvironmentFile = {
        localixApiEnvironment: ENVIRONMENT_FILE_VERSION,
        name: normalized,
        variables,
      }
      await atomicWriteFile(file, `${JSON.stringify(body, null, 2)}\n`)
      const saved = await read(file)
      return saved
        ? { ok: true, environment: saved }
        : { ok: false, problem: `"${normalized}" was written but could not be read back.` }
    },

    async remove(name) {
      const file = fileFor(name)
      if (file === null) return false
      try {
        await rm(file)
        return true
      } catch {
        return false
      }
    },

    async rename(from, to) {
      const existing = await this.get(from)
      if (!existing) return { ok: false, problem: `No environment named "${from}".` }
      const normalized = normalizeEnvironmentName(to)
      const fromFile = fileFor(existing.name)
      const toFile = normalized === null ? null : fileFor(normalized)
      if (normalized === null || fromFile === null || toFile === null) {
        return {
          ok: false,
          problem: `"${to}" is not a usable environment name. Use one segment, e.g. \`staging\`.`,
        }
      }
      if (normalized !== existing.name && (await this.get(normalized))) {
        return { ok: false, problem: `An environment named "${normalized}" already exists.` }
      }
      if (normalized === existing.name) return { ok: true, environment: existing }

      // COPYFILE_EXCL is the no-clobber boundary. `rename()` overwrites its destination on POSIX,
      // so a second writer creating `to` after the check above could otherwise lose its file.
      // Keep the source until the complete target has been written and read back: a crash may
      // leave a recoverable duplicate, never destroy the only copy.
      try {
        await copyFile(fromFile, toFile, constants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return { ok: false, problem: `An environment named "${normalized}" already exists.` }
        }
        throw error
      }
      const body: EnvironmentFile = {
        localixApiEnvironment: ENVIRONMENT_FILE_VERSION,
        name: normalized,
        variables: existing.variables,
      }
      try {
        await atomicWriteFile(toFile, `${JSON.stringify(body, null, 2)}\n`)
      } catch (error) {
        await rm(toFile, { force: true }).catch(() => undefined)
        throw error
      }
      const moved = await read(toFile)
      if (!moved) {
        await rm(toFile, { force: true }).catch(() => undefined)
        return { ok: false, problem: `"${normalized}" was copied but could not be read back.` }
      }
      await rm(fromFile)
      return { ok: true, environment: moved }
    },
  }
}
