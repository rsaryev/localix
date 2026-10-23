/**
 * WHICH environment is active — one person's current target, kept out of the collection.
 *
 * It used to be a boolean on the stored environment, which was fine while the store was a private
 * per-user file. Now the environments are committed, and the same flag would mean: a colleague's
 * `git pull` silently re-points your next send at whatever deployment they were using, and a merge
 * decides it by conflict resolution. That is a production request sent at staging because someone
 * else rebased.
 *
 * So the pointer lives in the mini app's own state directory, keyed by COLLECTION ROOT — two
 * projects open in two windows each keep their own active environment, which is the behaviour a
 * person expects and the one a single global pointer cannot give.
 *
 * Absence is meaningful: no entry means NO environment is active, and a request with a
 * `{{placeholder}}` then fails loudly rather than rendering against whatever happens to be first.
 */

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile, safeFileKey } from '@localixai/mini-app-sdk/backend'

/** One JSON object: `{ "<collection root>": "<environment name>" }`. */
type ActiveMap = Record<string, string>

const FILE = 'active-environment.json'

async function readMap(stateDir: string): Promise<ActiveMap> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(stateDir, FILE), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as ActiveMap) : {}
  } catch {
    return {} // absent or unreadable — nothing is active, which is a valid state
  }
}

/**
 * The key a collection is remembered under.
 *
 * `safeFileKey` is not doing path duty here — the root is a VALUE inside one JSON file, not a
 * filename — but it keeps the key short, printable and diffable, and the collision it can produce
 * (two roots differing only in punctuation) costs at most a shared active pointer between two
 * projects, never a leak.
 */
function keyFor(collectionRoot: string): string {
  return safeFileKey(collectionRoot)
}

export interface ActiveEnvironmentStore {
  get(collectionRoot: string): Promise<string | null>
  set(collectionRoot: string, name: string | null): Promise<void>
}

export function createActiveEnvironmentStore(stateDir: string): ActiveEnvironmentStore {
  return {
    async get(collectionRoot) {
      return (await readMap(stateDir))[keyFor(collectionRoot)] ?? null
    },

    async set(collectionRoot, name) {
      const map = await readMap(stateDir)
      const key = keyFor(collectionRoot)
      // DELETE rather than store an empty string: "no active environment" and "active environment
      // named ''" must not be the same entry, and the reader tells them apart by presence.
      if (name === null) delete map[key]
      else map[key] = name
      await mkdir(stateDir, { recursive: true })
      await atomicWriteFile(path.join(stateDir, FILE), `${JSON.stringify(map, null, 2)}\n`)
    },
  }
}
