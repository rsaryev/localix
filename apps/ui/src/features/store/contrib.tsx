import { lazy, Suspense, useMemo } from 'react'
import { Store } from 'lucide-react'

import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import type { WorkItem } from '@/shared/lib/workItem'
import { STORE_KIND, type StoreTarget } from '@/shared/lib/openStore'

const StorePageLazy = lazy(() =>
  import('./ui/StorePage').then((module) => ({ default: module.StorePage })),
)

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null
const pair = (value: unknown, a: string, b: string) => {
  const r = record(value)
  return r && typeof r[a] === 'string' && typeof r[b] === 'string'
    ? { [a]: r[a] as string, [b]: r[b] as string }
    : undefined
}

/** Where a tab payload asks the Store to open; what does not parse is left out. */
export function storeTarget(payload: Record<string, unknown> | undefined): StoreTarget {
  const ref = pair(payload?.ref, 'kind', 'id') as StoreTarget['ref']
  const addSource = pair(payload?.addSource, 'kind', 'input') as StoreTarget['addSource']
  return {
    ...(typeof payload?.shelf === 'string' ? { shelf: payload.shelf } : {}),
    ...(ref ? { ref } : {}),
    ...(addSource ? { addSource } : {}),
  }
}

function StoreBody({ item }: { item?: WorkItem }) {
  // A new open of the tab is a new payload object: the Store goes where it says.
  const payload = item?.payload
  const target = useMemo(() => storeTarget(payload), [payload])
  return (
    <Suspense fallback={<LoadingHint>Opening the Store…</LoadingHint>}>
      <StorePageLazy target={target} />
    </Suspense>
  )
}

let registered = false

/** The Store as its own workspace tab, opened by the rail, Settings, setup and links. */
export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true
  host.workItems.register({
    kind: STORE_KIND,
    Component: StoreBody,
    Icon: Store,
    restorable: true,
    scope: 'global',
  })
}
