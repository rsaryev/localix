import { inspector } from '@/shared/lib/inspectorBus'

/** The store's tab kind: one app-level tab, registered by `features/mini-app-store`. */
export const MINI_APP_STORE_KIND = 'mini-app-store'

/** Open the store in its tab, or focus it — it belongs to no chat. */
export function openMiniAppStore(): void {
  inspector.openWorkItem({
    workKind: MINI_APP_STORE_KIND,
    id: MINI_APP_STORE_KIND,
    title: 'Mini apps',
    scope: null,
  })
}
