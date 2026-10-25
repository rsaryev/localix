import type {
  ActionResult,
  ConfigValue,
  CreateForm,
  ItemAction,
  ListingRef,
  PackageKind,
  Scope,
  ShelfPlan,
  StoreActor,
  StoreProvider,
} from '@localixai/store'

import { unsupported } from './unsupported'

/**
 * WHAT A PERSON MAKES AND DOES WITH AN ITEM, over whichever provider owns the kind
 * (`docs/internals/store.md`, "Create and actions"): the form for a new one, creating it, and
 * running one of an install's own actions. The provider keeps what they mean; the Store only
 * routes them and tells the index to read again.
 */
export function itemService(
  providers: readonly StoreProvider[],
  providerOf: (kind: PackageKind) => StoreProvider,
  invalidate: () => void,
) {
  return {
    /** The kinds whose provider can make a new item. */
    creatable: (): PackageKind[] =>
      providers
        .filter((provider) => 'createFields' in provider && 'create' in provider)
        .map((provider) => provider.kind),

    async createFields(kind: PackageKind, actor: StoreActor): Promise<CreateForm> {
      const provider = providerOf(kind)
      if (!provider.createFields) throw unsupported(kind, 'be made here')
      return provider.createFields(actor)
    },

    async create(
      kind: PackageKind,
      scope: Scope,
      values: Record<string, ConfigValue>,
      actor: StoreActor,
    ): Promise<ListingRef> {
      const provider = providerOf(kind)
      if (!provider.create) throw unsupported(kind, 'be made here')
      const ref = await provider.create(scope, values, actor)
      invalidate()
      return ref
    },

    /** What each kind's provider can do to a shelf of its own items, for one scope. */
    async shelfActions(
      scope: Scope,
      actor: StoreActor,
    ): Promise<Array<ItemAction & { kind: PackageKind }>> {
      const lists = await Promise.all(
        providers.map(async (provider) =>
          ((await provider.shelfActions?.(scope, actor)) ?? []).map((action) => ({
            ...action,
            kind: provider.kind,
          })),
        ),
      )
      return lists.flat()
    },

    async planShelfAction(
      kind: PackageKind,
      action: string,
      scope: Scope,
      actor: StoreActor,
    ): Promise<ShelfPlan> {
      const provider = providerOf(kind)
      if (!provider.planShelfAction) throw unsupported(kind, 'do that to a shelf')
      return provider.planShelfAction(action, scope, actor)
    },

    async runShelfAction(
      kind: PackageKind,
      action: string,
      scope: Scope,
      ids: string[],
      actor: StoreActor,
    ): Promise<ActionResult> {
      const provider = providerOf(kind)
      if (!provider.runShelfAction) throw unsupported(kind, 'do that to a shelf')
      const result = await provider.runShelfAction(action, scope, ids, actor)
      invalidate()
      return result
    },

    async runAction(
      ref: ListingRef,
      scope: Scope,
      action: string,
      actor: StoreActor,
    ): Promise<ActionResult> {
      const provider = providerOf(ref.kind)
      if (!provider.runAction) throw unsupported(ref.kind, 'run actions')
      const result = await provider.runAction(ref.id, scope, action, actor)
      invalidate()
      return result
    },
  }
}
