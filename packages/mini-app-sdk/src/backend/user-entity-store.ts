/**
 * Per-user, file-backed store for a list of identified entities — the ONE owner of the
 * cache + write-lock + atomic-commit discipline that saved-connection stores need.
 *
 * WHY THIS EXISTS. Two workbench mini apps each kept their own copy of this file, ~95%
 * identical line for line, and one copy's header said so out loud: it mirrors
 * "the same atomic-write + per-user write-lock + cache discipline, WHICH IS WHAT CLOSED
 * ITS MID-WRITE READ RACE". That is a copy of a bug FIX, documented as a copy. The race
 * it closes (a `reconnect` intermittently 404ing with `connection_not_found` because a
 * reader observed a half-written file) is subtle enough that nobody would re-derive it
 * on the third copy — they would just re-introduce it.
 *
 * Lives in the mini app SDK (not `apps/api`) because it is dependency-free reusable
 * machinery a bundled mini app backend compiles against — a stateless factory, not a
 * host singleton: each call owns its own cache/lock and its own directory, so two
 * mini apps' stores never share state. The host owns no instance of it.
 *
 * THE FOUR PROPERTIES, which are the whole point:
 *
 *  1. CACHED READS. After the first load a `get`/`list` never touches the disk again, so
 *     it cannot observe a file mid-write.
 *  2. ENOENT IS AN EMPTY LIST, and it IS cached — "no file yet" is a legitimate state.
 *  3. ANY OTHER READ ERROR IS NOT CACHED. A transient failure must not be frozen in as
 *     "the user has nothing"; a later read has to be able to recover.
 *  4. WRITES ARE SERIALIZED PER USER AND COMMITTED ATOMICALLY (temp + rename), so two
 *     concurrent upserts cannot clobber each other's edit and a concurrent reader sees
 *     the old file or the new one — never a partial one.
 *
 * Entities are identified by `id`. The two write paths are deliberately SEPARATE — see
 * `EntityPatch` for why a single `upsert(entity)` was a bug factory:
 *
 *  - `create(entity)` appends (or replaces by id) a WHOLE new entity — the one place a
 *    record may be built from thin air, because the caller is minting it.
 *  - `updateById(id, patch)` MERGES a patch into the stored entity — the only way to edit an
 *    existing one, and it will not accept a whole record.
 */
import { chmod, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteFile } from './file-io'

/**
 * A PATCH to a stored entity: every field EXCEPT `id`, all optional, and `id` forbidden.
 *
 * WHY THIS TYPE, and why it forbids `id`.
 *
 * The old `upsert(userId, entity: T)` took a WHOLE entity and wrote it over the stored row,
 * so a caller that rebuilt the entity from the handful of fields it happened to know silently
 * deleted every OTHER field on the row. That is the `write-shape` bug class — it produced the
 * extension-owned `updateConfig` field-wipe (read the saved row, throw it away, reconstruct from the
 * method's four arguments), the MCP credential wipe, and more. All of them type-checked,
 * because every dropped field is OPTIONAL.
 *
 * `updateById` takes an `EntityPatch<T>` instead. A patch CANNOT carry the row's identity
 * (`id?: never`), so a whole `T` — which requires `id: string` — is not assignable to it:
 * the compiler rejects a rebuilt record at the call site. A caller can only express the
 * DELTA it authored; the store supplies the rest, from the row it read. The class is not
 * forbidden by convention any more — it is unwritable.
 *
 * A key present with value `undefined` clears the field (spread semantics); a key that is
 * absent leaves the stored value untouched. So "don't touch what I wasn't asked to change" is
 * a conditional spread, never a bare `{ field: maybeUndefined }`.
 */
export type EntityPatch<T extends { id: string }> = {
  [K in Exclude<keyof T, 'id'>]?: T[K]
} & { id?: never }

export interface UserEntityStore<T extends { id: string }> {
  /** Drop a cached snapshot after an authoritative external file change. */
  invalidate?: (userId: string) => void
  list(userId: string): Promise<T[]>
  get(userId: string, id: string): Promise<T | null>
  /**
   * Append a WHOLE new entity (or replace one that already carries this id). This is the
   * create path — the caller minted the entity, so building it from scratch is correct. To
   * EDIT an existing entity, use {@link updateById}, which will not take a whole record.
   */
  create(userId: string, entity: T): Promise<void>
  /**
   * Merge a patch into the stored entity and return the merged value, or `null` when no
   * entity has that id. `id` is re-pinned from the stored row, so a patch cannot re-key it.
   */
  updateById(userId: string, id: string, patch: EntityPatch<T>): Promise<T | null>
  remove(userId: string, id: string): Promise<void>
}

export interface UserEntityStoreOptions {
  /** Directory the per-user JSON files live in. Created on first write. */
  dir: string
  /**
   * userId → filename stem.
   *
   * REQUIRED, and deliberately not defaulted: this is the PATH-TRAVERSAL BOUNDARY, not
   * formatting. It is what stops a crafted userId (`../../etc/passwd`, an absolute path,
   * a NUL) from steering the `path.join` below out of `dir`. Pass a real allow-list
   * sanitizer — every character outside `[A-Za-z0-9_-]` replaced — never the identity
   * function. (Callers today pass their existing `safeFileKey`/`safeName`; once the
   * shared `safeFileKey` primitive is this package's own, and is the default.)
   */
  fileKey: (userId: string) => string
  /** Maximum user snapshots retained in memory by this store instance. */
  maxCachedUsers?: number
  /**
   * File mode for the per-user snapshot. Defaults to 0600 (owner-only), and the directory to
   * 0700, because every store built on this primitive holds user-owned entities that carry LIVE
   * CREDENTIALS as authored — database connection URLs with embedded passwords, REST request
   * headers with API keys, exchange key/secret/passphrase. Those were being written at the
   * process default (0644 under a 0755 directory), so any other local account could read them,
   * while `atomicWriteFile`'s own doc explains why the mode belongs on the temp file and two other
   * call sites in the repo (the master key, the MCP OAuth store) already pass 0600.
   *
   * Overridable only for a store that genuinely holds nothing private; there is no such caller
   * today. Note the OS has the last word: `writeFile` applies `mode & ~umask`, so this option can
   * only ever NARROW — a store asking for 0644 gets 0600 under `umask 077`. That is why the fix
   * rests on the 0600 default rather than on any explicit value.
   */
  mode?: number
}

export const USER_ENTITY_STORE_DEFAULT_CACHE_USERS = 256

export function createUserEntityStore<T extends { id: string }>(
  opts: UserEntityStoreOptions,
): UserEntityStore<T> {
  const fileFor = (userId: string) => path.join(opts.dir, `${opts.fileKey(userId)}.json`)
  const maxCachedUsers = opts.maxCachedUsers ?? USER_ENTITY_STORE_DEFAULT_CACHE_USERS
  if (!Number.isSafeInteger(maxCachedUsers) || maxCachedUsers <= 0) {
    throw new RangeError('maxCachedUsers must be a positive safe integer')
  }

  const cache = new Map<string, T[]>()
  let cacheEpoch = 0
  const writeTail = new Map<string, Promise<unknown>>()
  const cloneEntity = (entity: T): T => structuredClone(entity)
  const cloneList = (list: T[]): T[] => list.map(cloneEntity)
  const cacheGet = (userId: string): T[] | undefined => {
    const value = cache.get(userId)
    if (value === undefined) return undefined
    // Map insertion order is our LRU queue. Reads are activity too: a hot user's
    // snapshot should not be evicted by a stream of one-off users.
    cache.delete(userId)
    cache.set(userId, value)
    return value
  }
  const cacheSet = (userId: string, value: T[]): void => {
    cache.delete(userId)
    cache.set(userId, value)
    while (cache.size > maxCachedUsers) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  async function load(userId: string): Promise<T[]> {
    const cached = cacheGet(userId)
    if (cached !== undefined) return cached
    const epoch = cacheEpoch
    let list: T[]
    const target = fileFor(userId)
    try {
      const parsed = JSON.parse(await readFile(target, 'utf8'))
      // Repair a snapshot an older version left world-readable. On the READ path because that is
      // the one a user who never edits their connections still takes.
      await repairMode(target)
      list = Array.isArray(parsed) ? (parsed as T[]) : []
    } catch (err) {
      // ENOENT (no file yet) is an empty list; any other error (e.g. a transient read)
      // must NOT be cached as empty — rethrow so the caller doesn't treat it as "gone".
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') list = []
      else throw err
    }
    if (epoch !== cacheEpoch) return load(userId)
    cacheSet(userId, list)
    return list
  }

  /**
   * Narrow an existing snapshot that a version before the 0600 default left world-readable.
   *
   * `persist` alone was not enough: it repairs on WRITE, so a user who saves a connection once and
   * never edits it again keeps a 0644 file holding a live password indefinitely. The database got
   * repair-on-open for exactly this reason; the stores now match. Best effort — an unwritable mode
   * (an exotic filesystem, a read-only mount) must not fail a read.
   */
  async function repairMode(target: string): Promise<void> {
    const mode = opts.mode ?? 0o600
    try {
      const current = await stat(target)
      if ((current.mode & 0o777) !== mode) await chmod(target, mode)
    } catch {
      // absent file, or a filesystem without POSIX modes
    }
  }

  async function persist(userId: string, list: T[]): Promise<void> {
    // The cache is a view of DURABLE state. Clone before the first await so neither
    // caller-owned values nor later mutations can leak into the committed snapshot.
    const snapshot = cloneList(list)
    const target = fileFor(userId)
    // `rename` carries the TEMP file's mode onto the target, so passing it here also repairs a
    // snapshot that an earlier version left world-readable — no separate chmod window.
    await atomicWriteFile(target, JSON.stringify(snapshot, null, 2), { mode: opts.mode ?? 0o600 })
    cacheSet(userId, snapshot)
  }

  /** Serialize mutations per user so two concurrent upserts can't clobber each other's edit. */
  function withWriteLock<R>(userId: string, fn: () => Promise<R>): Promise<R> {
    const prev = writeTail.get(userId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const settled = next.then(
      () => undefined,
      () => undefined,
    )
    writeTail.set(userId, settled)
    // Only the newest tail may delete its key: an older mutation can settle after
    // a successor has already installed a new tail for the same user.
    void settled.then(() => {
      if (writeTail.get(userId) === settled) writeTail.delete(userId)
    })
    return next
  }

  return {
    invalidate(userId) {
      cacheEpoch++
      cache.delete(userId)
    },
    async list(userId) {
      return cloneList(await load(userId))
    },
    async get(userId, id) {
      const entity = (await load(userId)).find((e) => e.id === id)
      return entity ? cloneEntity(entity) : null
    },
    create(userId, entity) {
      return withWriteLock(userId, async () => {
        const list = [...(await load(userId))]
        const i = list.findIndex((e) => e.id === entity.id)
        if (i >= 0) list[i] = entity
        else list.push(entity)
        await persist(userId, list)
      })
    },
    updateById(userId, id, patch) {
      return withWriteLock(userId, async () => {
        const list = [...(await load(userId))]
        const i = list.findIndex((e) => e.id === id)
        if (i < 0) return null
        // Merge the patch and re-pin identity from the stored row: a whole-record write is
        // already rejected by `EntityPatch`, and this defends the `id` even against an `any`.
        const merged = { ...list[i], ...patch, id: list[i]!.id } as T
        list[i] = merged
        await persist(userId, list)
        return cloneEntity(merged)
      })
    },
    remove(userId, id) {
      return withWriteLock(userId, async () => {
        await persist(
          userId,
          (await load(userId)).filter((e) => e.id !== id),
        )
      })
    },
  }
}
