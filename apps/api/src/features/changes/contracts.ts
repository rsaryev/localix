/**
 * The change feed's types: what changed, said once for every consumer.
 *
 * A change is a thin notice — `{ entity, op, ref }` — never the entity's state: a consumer reads
 * what it needs from the entity's owner, so a notice delivered twice, or after a newer one, does
 * no harm (delivery is at least once). Two operations are enough for that: `upserted` (created or
 * changed: a consumer re-reads either way) and `deleted` (nothing is left to read, so the notice
 * carries the ref the cleanup needs). `resync` says "anything of this kind may have changed"
 * for an owner that cannot name keys (files edited outside the app): the consumer reconciles.
 *
 * Deleting a parent deletes its children (a chat's messages) without a notice per child; the
 * registry's `cascades` say which, and every consumer of a child kind receives `parent-deleted`.
 * The types make each consumer answer for every kind: a kind added to a registry fails to compile
 * until every consumer says what it does with it, so nothing is left behind as dead data.
 */
import type { z } from 'zod'

/** Each entity kind's ref: what a notice says about it (ids, owner, scope — never content). */
export type RefSchemas = Record<string, z.ZodType<Record<string, unknown>>>

export type EntityKind<R extends RefSchemas> = keyof R & string
export type EntityRef<R extends RefSchemas, K extends EntityKind<R>> = z.infer<R[K]>

/** Parent kind → the child kinds its deletion deletes. */
export type Cascades<R extends RefSchemas> = Partial<
  Record<EntityKind<R>, readonly EntityKind<R>[]>
>

export type Change<R extends RefSchemas, K extends EntityKind<R> = EntityKind<R>> = {
  [E in K]:
    | { entity: E; op: 'upserted' | 'deleted'; ref: EntityRef<R, E> }
    | { entity: E; op: 'resync' }
}[K]

/** A deletion, the only change a cascade starts from. */
export type Deletion<R extends RefSchemas, K extends EntityKind<R> = EntityKind<R>> = {
  [E in K]: { entity: E; op: 'deleted'; ref: EntityRef<R, E> }
}[K]

/** The kinds whose deletion deletes `K`. */
type ParentOf<R extends RefSchemas, C extends Cascades<R>, K extends EntityKind<R>> = {
  [P in keyof C & EntityKind<R>]: C[P] extends readonly (infer Child)[]
    ? K extends Child
      ? P
      : never
    : never
}[keyof C & EntityKind<R>]

/** What a consumer of kind `K` receives: its own changes, and its parents' deletions. */
export type Delivery<R extends RefSchemas, C extends Cascades<R>, K extends EntityKind<R>> =
  | Change<R, K>
  | ([ParentOf<R, C, K>] extends [never]
      ? never
      : { entity: K; op: 'parent-deleted'; parent: Deletion<R, ParentOf<R, C, K>> })

/**
 * A consumer: one answer per kind — a handler, or `'ignore'` said out loud. A handler that throws
 * is retried later with backoff; its cursor does not move past the change until it succeeds (or
 * gives up on it after a few attempts, leaving the gap to its reconcile).
 */
export type ConsumerHandlers<R extends RefSchemas, C extends Cascades<R>> = {
  [K in EntityKind<R>]: ((delivery: Delivery<R, C, K>) => Promise<void> | void) | 'ignore'
}

/** A registry: its kinds' refs and cascades, declared once, read by producers and consumers. */
export interface EntityRegistry<R extends RefSchemas, C extends Cascades<R>> {
  refs: R
  cascades: C
}
