/**
 * How semantic search follows a change feed without knowing any entity: each feature that owns
 * an indexed kind declares its target — the collection, an item's key from a notice's ref, and
 * any other items the change may have touched — and this turns notices into index work:
 *   - `upserted` / `deleted`: the item's key is re-read (an item its source no longer returns is
 *     deleted);
 *   - `resync`: the collection is reconciled;
 *   - `parent-deleted`: every item stored under the parent goes.
 * The targets map is typed over the whole registry: a kind added to it does not compile until it
 * is given a target, or `'ignore'`.
 */
import type {
  Cascades,
  ConsumerHandlers,
  EntityKind,
  EntityRef,
  RefSchemas,
} from '@localixai/change-feed'
import type { SemanticService } from './service'

export interface SemanticTarget<Ref> {
  collection: string
  /** The item's key in its collection (also what its children name as their parent). */
  keyOf(ref: Ref): string
  /** Other items a change to this one may have changed. */
  related?(ref: Ref): Promise<ReadonlyArray<{ collection: string; key: string }>>
}

export type SemanticTargets<R extends RefSchemas> = {
  [K in EntityKind<R>]: SemanticTarget<EntityRef<R, K>> | 'ignore'
}

type Index = Pick<SemanticService, 'changed' | 'resync' | 'removeUnder'>
type AnyChange = {
  op: 'upserted' | 'deleted' | 'resync' | 'parent-deleted'
  ref?: Record<string, unknown>
  parent?: { entity: string; ref: Record<string, unknown> }
}

export function semanticHandlers<R extends RefSchemas, C extends Cascades<R>>(
  targets: SemanticTargets<R>,
  index: Index,
): ConsumerHandlers<R, C> {
  const all = targets as Record<string, SemanticTarget<Record<string, unknown>> | 'ignore'>
  const handlers: Record<string, ((change: AnyChange) => Promise<void>) | 'ignore'> = {}
  for (const [kind, target] of Object.entries(all)) {
    if (target === 'ignore') {
      handlers[kind] = 'ignore'
      continue
    }
    handlers[kind] = async (change) => {
      if (change.op === 'resync') return index.resync(target.collection)
      if (change.op === 'parent-deleted') {
        const parent = all[change.parent!.entity]
        if (parent && parent !== 'ignore') {
          await index.removeUnder(target.collection, parent.keyOf(change.parent!.ref))
        }
        return
      }
      await index.changed(target.collection, [target.keyOf(change.ref!)])
      if (change.op !== 'upserted' || !target.related) return
      for (const item of await target.related(change.ref!)) {
        await index.changed(item.collection, [item.key])
      }
    }
  }
  return handlers as unknown as ConsumerHandlers<R, C>
}
