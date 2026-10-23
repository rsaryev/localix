/**
 * An in-memory {@link CollectionStore} — for tests of everything ABOVE the filesystem.
 *
 * The real store's behaviour is pinned against a real directory in `store.test.ts`, because every
 * claim there is about the filesystem (folders appearing from names, explicit empty directories,
 * a file dropped in by `git pull` being found). Nothing above it cares: a route test is about status
 * codes and redaction, an importer test about naming collisions. Giving each of those a temp
 * directory would make them slower and no more true.
 *
 * It is a DOUBLE, not a second implementation: the same name grammar decides what is storable, and
 * the same refusal decides what may be written, so a test cannot pass here on a name or a
 * credential the real store would reject.
 */

import { isStrictlyUnder } from '@localixai/path-containment/ancestry'
import type { RequestSpec } from '../../request-spec'
import { gitSafetyProblem } from '../../git-sync/format'
import { folderOf, normalizeFolderName, normalizeRequestName } from '../paths'
import type { CollectionRequest, CollectionStore, SaveOutcome } from '../store'

export interface MemoryCollection extends CollectionStore {
  /** Seed or inspect the contents directly, without going through `save`'s refusals. */
  readonly records: Map<string, CollectionRequest>
  readonly folders: Set<string>
}

export function createMemoryCollection(
  seed: ReadonlyArray<{ name: string; spec: RequestSpec }> = [],
  root = '/memory/.localix/api',
): MemoryCollection {
  const records = new Map<string, CollectionRequest>()
  const folders = new Set<string>()
  const now = Date.now()
  for (const { name, spec } of seed) {
    records.set(name, { name, spec, createdAt: now, updatedAt: now })
    const folder = folderOf(name)
    if (folder) {
      const parts = folder.split('/')
      for (let index = 1; index <= parts.length; index++)
        folders.add(parts.slice(0, index).join('/'))
    }
  }

  const store: MemoryCollection = {
    records,
    folders,
    root: () => root,
    list: async () => [...records.values()].sort((a, b) => a.name.localeCompare(b.name)),
    listFolders: async () => [...folders].sort((a, b) => a.localeCompare(b)),
    createFolder: async (name) => {
      const normalized = normalizeFolderName(name)
      if (!normalized) return { ok: false, problem: `"${name}" is not a usable folder name.` }
      const parts = normalized.split('/')
      for (let index = 1; index <= parts.length; index++)
        folders.add(parts.slice(0, index).join('/'))
      return { ok: true, name: normalized }
    },
    removeFolder: async (name) => {
      const normalized = normalizeFolderName(name)
      if (!normalized || !folders.has(normalized)) {
        return { ok: false, problem: `No folder named "${name}".` }
      }
      // Membership of a collection folder is the repo's ancestry question asked on the
      // relative `a/b` name grammar, so it goes through the owner the same way `store.ts`
      // does — rooted with a leading `/` to give the leaf the absolute paths it documents.
      // Strictly-under: the folder being removed is not a member of itself.
      const occupied = [...records.keys()].some((request) =>
        isStrictlyUnder(`/${normalized}`, `/${request}`),
      )
      const hasChildren = [...folders].some((folder) =>
        isStrictlyUnder(`/${normalized}`, `/${folder}`),
      )
      if (occupied || hasChildren) {
        return { ok: false, problem: `Folder "${normalized}" is not empty.` }
      }
      folders.delete(normalized)
      return { ok: true }
    },
    get: async (name) => records.get(normalizeRequestName(name) ?? name) ?? null,

    save: async (name, spec): Promise<SaveOutcome> => {
      const normalized = normalizeRequestName(name)
      if (normalized === null) {
        return { ok: false, problem: `"${name}" is not a usable request name.` }
      }
      const refusal = gitSafetyProblem(normalized, spec)
      if (refusal) return { ok: false, problem: refusal }
      const existing = records.get(normalized)
      const record: CollectionRequest = {
        name: normalized,
        spec,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      }
      records.set(normalized, record)
      const folder = folderOf(normalized)
      if (folder) {
        const parts = folder.split('/')
        for (let index = 1; index <= parts.length; index++)
          folders.add(parts.slice(0, index).join('/'))
      }
      return { ok: true, request: record }
    },

    remove: async (name) => records.delete(normalizeRequestName(name) ?? name),

    rename: async (from, to) => {
      const existing = records.get(normalizeRequestName(from) ?? from)
      if (!existing) return { ok: false, problem: `No saved request named "${from}".` }
      const normalized = normalizeRequestName(to)
      if (normalized === null)
        return { ok: false, problem: `"${to}" is not a usable request name.` }
      if (normalized !== existing.name && records.has(normalized)) {
        return { ok: false, problem: `A request named "${normalized}" already exists.` }
      }
      const saved = await store.save(normalized, existing.spec)
      if (saved.ok && normalized !== existing.name) records.delete(existing.name)
      return saved
    },
  }
  return store
}
