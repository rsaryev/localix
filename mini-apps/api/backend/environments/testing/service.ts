/**
 * TEST-ONLY environment service over a per-user record store. Production speaks the same
 * {@link EnvironmentService} contract through `../file-service.ts`; route tests use this one to
 * drive environments without a collection directory. The one place the "exactly one active" rule
 * is enforced.
 */

import type { UserEntityStore } from '@localixai/mini-app-sdk/backend'
import { normalizeEnvironmentName } from '../../collection/environments'
import { activePairs } from '../../request-spec'
import type { EnvironmentService } from '../service'
import type { SavedEnvironment } from '../store'

export type EnvironmentStore = UserEntityStore<SavedEnvironment>

export function createEnvironmentService(store: EnvironmentStore): EnvironmentService {
  const activeOf = async (userId: string) =>
    (await store.list(userId)).find((e) => e.active) ?? null

  return {
    list: (userId) => store.list(userId),
    get: (userId, name) => store.get(userId, name),

    async save(userId, name, variables) {
      const now = Date.now()
      const existing = await store.get(userId, name)
      // The FIRST environment saved becomes active. Otherwise a user saves one, sends, and gets
      // "variable not defined" — having created the only thing that could define it.
      const isFirst = (await store.list(userId)).length === 0
      const record: SavedEnvironment = {
        id: name,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        active: existing?.active ?? isFirst,
        variables,
      }
      await store.create(userId, record)
      return record
    },

    /**
     * Make `name` the active environment, clearing the flag everywhere else.
     *
     * Read-then-write across several records rather than one atomic swap: the store serialises per
     * user, so the writes cannot interleave with each other, and the set is 2–5 records. The cost
     * of the naive version is that a crash mid-loop could leave two actives — which `activeVars`
     * survives (it takes the first) and the next `use` repairs. A dedicated transaction for that
     * would be machinery for a window measured in microseconds on a local single-user file.
     */
    async use(userId, name) {
      const target = await store.get(userId, name)
      if (!target) return null
      for (const env of await store.list(userId)) {
        const shouldBeActive = env.id === name
        if (env.active !== shouldBeActive) {
          await store.updateById(userId, env.id, { active: shouldBeActive })
        }
      }
      return { ...target, active: true }
    },

    /** The "no environment" state, chosen explicitly — same loop as `use`, target none. */
    async deactivate(userId) {
      for (const env of await store.list(userId)) {
        if (env.active) await store.updateById(userId, env.id, { active: false })
      }
    },

    async remove(userId, name) {
      const existing = await store.get(userId, name)
      if (!existing) return false
      await store.remove(userId, name)
      // Deleting the ACTIVE environment leaves none active rather than silently promoting
      // another: which one would be a guess, and sending against a guessed environment is exactly
      // the mistake environments exist to prevent.
      return true
    },

    async rename(userId, from, to) {
      const existing = await store.get(userId, from)
      if (!existing) return null
      const normalized = normalizeEnvironmentName(to)
      if (normalized === null) throw new Error(`"${to}" is not a usable environment name.`)
      if (normalized !== existing.id && (await store.get(userId, normalized))) {
        throw new Error(`An environment named "${normalized}" already exists.`)
      }
      if (normalized === existing.id) return existing
      const moved: SavedEnvironment = {
        ...existing,
        id: normalized,
        updatedAt: Date.now(),
      }
      await store.create(userId, moved)
      await store.remove(userId, existing.id)
      return moved
    },

    async activeVars(userId) {
      const active = await activeOf(userId)
      if (!active) return new Map()
      return new Map(activePairs(active.variables).map((v) => [v.name, v.value]))
    },

    async activeName(userId) {
      return (await activeOf(userId))?.id ?? null
    },
  }
}
