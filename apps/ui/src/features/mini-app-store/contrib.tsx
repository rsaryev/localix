import { lazy, Suspense } from 'react'
import { LayoutGrid } from 'lucide-react'

import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import type { WorkItem } from '@/shared/lib/workItem'
import { MINI_APP_STORE_KIND } from '@/shared/lib/openMiniAppStore'

const MiniAppStorePageLazy = lazy(() =>
  import('./ui/MiniAppStorePage').then((module) => ({ default: module.MiniAppStorePage })),
)

function MiniAppStoreBody({ item }: { item?: WorkItem }) {
  // A `localix://` link to add a catalog opens this tab with the address as its payload.
  const addCatalog =
    typeof item?.payload?.addCatalog === 'string' ? item.payload.addCatalog : undefined
  return (
    <Suspense fallback={<LoadingHint>Opening the store…</LoadingHint>}>
      <MiniAppStorePageLazy addCatalogUrl={addCatalog} />
    </Suspense>
  )
}

let registered = false

/** The mini app store as its own workspace tab, opened by the rail's add button and the first run. */
export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true
  host.workItems.register({
    kind: MINI_APP_STORE_KIND,
    Component: MiniAppStoreBody,
    Icon: LayoutGrid,
    restorable: true,
    scope: 'global',
  })
}
