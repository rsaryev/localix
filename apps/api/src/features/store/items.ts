import type {
  ActionResult,
  ConfigValue,
  CreateForm,
  ListingRef,
  PackageKind,
  Scope,
  StoreActor,
  StoreProvider,
} from '@localixai/store'

import { ConflictError } from '../../lib/domain-errors'

const unsupported = (kind: PackageKind, what: string) =>
  new ConflictError('store_unsupported', `${kind} packages cannot ${what}`)

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
