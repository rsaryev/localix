import { inspector } from '@/shared/lib/inspectorBus'

/** The Store's tab kind: one app-level tab, registered by `features/store`. */
export const STORE_KIND = 'store'

/** Where the Store opens: a shelf, one listing's page, or the add dialog filled in. */
export interface StoreTarget {
  shelf?: string
  ref?: { kind: string; id: string }
  addSource?: { kind: string; input: string }
}

/** Open the Store in its tab, or focus it, at `target` — it belongs to no chat. */
export function openStore(target: StoreTarget = {}): void {
  inspector.openWorkItem({
    workKind: STORE_KIND,
    id: STORE_KIND,
    title: 'Store',
    scope: null,
    payload: { ...target },
  })
}

/** The Store on its Mini apps shelf: where every "add a mini app" entry point leads. */
export const openMiniAppStore = (): void => openStore({ shelf: 'package:mini-app' })
