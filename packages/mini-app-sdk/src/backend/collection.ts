import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MiniAppContext } from './context'
import { openJsonStore, type JsonStore } from './json-store'
import type { SemanticSourceItem } from './semantic'

/**
 * COLLECTIONS — a mini app's list of things (meals, habits, expenses, cards) declared once.
 *
 * Every mini app that keeps a list wrote the same five parts by hand: a JSON store under the right
 * folder, a route per action that answers with the new list, the store feed that tells an open view
 * the agent changed something, a tool path into the same store, and, sometimes, a semantic source.
 * Each part had its own way to go wrong (a second copy of the state in the view, a route that
 * answered with the item instead of the list, a per-chat store resolved from the wrong session).
 *
 * A collection is the spec of that list: what an item is, what a person or the agent sends to add
 * one, and how an item is made from it. The mini app keeps only its business rules; `createMiniApp`
 * turns the spec into the store, the routes, the feed and the index.
 */
export interface CollectionSpec<T extends { id: string }, S extends z.ZodRawShape> {
  /** Lower-case name: the file `<name>.json`, the route `/rpc/<app>/<name>` and the index name. */
  name: string
  /** A stored item. Its `id` is the collection's; everything else is the app's. */
  item: z.ZodType<T>
  /** What the view or the agent sends to add one. A change sends any part of it. */
  input: z.ZodObject<S>
  /** The item made from one validated input: the business rule of adding. */
  create: (input: z.infer<z.ZodObject<S>>, meta: { id: string; now: Date }) => T
  /** `app`: one list for the mini app (`ctx.dataDir`). `chat`: one list per chat. Default `app`. */
  scope?: 'app' | 'chat'
  /** Keep only the newest `limit` items. Default 1000. */
  limit?: number
  /** The text the embedding model indexes, to find items by meaning (`app` scope only). */
  search?: (item: T) => string
}

/** Which chat a `chat`-scoped call is for: `context.session.id` in a tool, `c.env` in a route. */
export interface CollectionWhere {
  sessionId?: string | null
  userId?: string
}

export interface Collection<T extends { id: string }, S extends z.ZodRawShape> {
  readonly spec: CollectionSpec<T, S>
  /** Every item, oldest first. */
  list(where?: CollectionWhere): Promise<T[]>
  get(id: string, where?: CollectionWhere): Promise<T | null>
  /** Validate `input`, make the item, store it; resolves to the new item. */
  add(input: z.input<z.ZodObject<S>>, where?: CollectionWhere): Promise<T>
  /** Change part of one item; null when the id is unknown. */
  update(
    id: string,
    patch: Partial<z.input<z.ZodObject<S>>>,
    where?: CollectionWhere,
  ): Promise<T | null>
  /** False when the id is unknown. */
  remove(id: string, where?: CollectionWhere): Promise<boolean>
  /** Items nearest in meaning to `text`, best first; empty until the embedding model is ready. */
  search(text: string, options?: { limit?: number; userId?: string }): Promise<T[]>
  /** The folder a scope's items live in: for routes and the store feed. */
  folder(where?: CollectionWhere): Promise<string>
}

const DEFAULT_LIMIT = 1000

/** Declare a collection. Pure data: the same spec serves the backend, its tests and its tools. */
export function defineCollection<T extends { id: string }, S extends z.ZodRawShape>(
  spec: CollectionSpec<T, S>,
): CollectionSpec<T, S> {
  if (!/^[a-z][a-z0-9-]*$/u.test(spec.name)) {
    throw new Error(`A collection name is lower-case letters, digits and dashes: ${spec.name}`)
  }
  return spec
}

/** The stored file: one object, so a later field (a version, settings) never breaks a reader. */
export const collectionFileSchema = <T>(item: z.ZodType<T>) => z.object({ items: z.array(item) })

/** Open a collection's store and the operations a tool and a route share. */
export function openCollection<T extends { id: string }, S extends z.ZodRawShape>(
  ctx: MiniAppContext,
  spec: CollectionSpec<T, S>,
  now: () => Date = () => new Date(),
): Collection<T, S> {
  const fileSchema = collectionFileSchema(spec.item)
  const patchSchema = spec.input.partial()
  const limit = spec.limit ?? DEFAULT_LIMIT
  const semantic = spec.search && spec.scope !== 'chat' ? ctx.host?.semantic : undefined

  const folder = async (where: CollectionWhere = {}): Promise<string> => {
    if (spec.scope !== 'chat') return ctx.dataDir
    if (!where.sessionId)
      throw new Error(`The ${spec.name} collection needs the chat it belongs to.`)
    if (!ctx.sessionStorage) throw new Error('This host keeps no data per chat.')
    return ctx.sessionStorage.resolveDataDir(where.userId ?? ctx.userId, where.sessionId)
  }
  const store = async (where?: CollectionWhere): Promise<JsonStore<{ items: T[] }>> =>
    openJsonStore({
      dir: await folder(where),
      file: `${spec.name}.json`,
      schema: fileSchema,
      initial: { items: [] },
    })
  const announce = (id: string) => semantic?.changed(spec.name, [id])
  const sourceItem = (item: T): SemanticSourceItem => ({
    key: item.id,
    userId: ctx.userId,
    text: spec.search?.(item) ?? '',
  })

  const collection: Collection<T, S> = {
    spec,
    folder,
    list: async (where) => (await (await store(where)).read()).items,
    get: async (id, where) => (await collection.list(where)).find((item) => item.id === id) ?? null,
    async add(input, where) {
      const item = spec.create(spec.input.parse(input), { id: randomUUID(), now: now() })
      await (await store(where)).update(({ items }) => ({ items: [...items, item].slice(-limit) }))
      announce(item.id)
      return item
    },
    async update(id, patch, where) {
      const changes = patchSchema.parse(patch)
      let changed: T | null = null
      await (
        await store(where)
      ).update(({ items }) => ({
        items: items.map((item) => {
          if (item.id !== id) return item
          changed = spec.item.parse({ ...item, ...changes })
          return changed
        }),
      }))
      if (changed) announce(id)
      return changed
    },
    async remove(id, where) {
      let removed = false
      await (
        await store(where)
      ).update(({ items }) => {
        const kept = items.filter((item) => item.id !== id)
        removed = kept.length !== items.length
        return { items: kept }
      })
      if (removed) announce(id)
      return removed
    },
    async search(text, options = {}) {
      if (!semantic) return []
      const matches = await semantic.query(options.userId ?? ctx.userId, spec.name, text, {
        limit: options.limit ?? 20,
      })
      const byId = new Map((await collection.list()).map((item) => [item.id, item]))
      return matches
        .filter((match) => match.z >= match.gate)
        .flatMap((match) => byId.get(match.key) ?? [])
    },
  }

  // The index pulls the items itself, so it can be rebuilt from this file at any time (P9).
  semantic?.registerSource({
    collection: spec.name,
    label: spec.name,
    version: 1,
    async scan(cursor, size) {
      const items = await collection.list()
      const start = cursor ? Number(cursor) : 0
      const page = items.slice(start, start + size)
      return {
        items: page.map(sourceItem),
        next: start + size < items.length ? String(start + size) : null,
      }
    },
    async read(keys) {
      const wanted = new Set(keys)
      return (await collection.list()).filter((item) => wanted.has(item.id)).map(sourceItem)
    },
    count: async () => (await collection.list()).length,
  })
  return collection
}
