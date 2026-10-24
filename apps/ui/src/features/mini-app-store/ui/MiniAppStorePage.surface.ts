import { LayoutGrid } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { MINI_APP_STORE_KIND } from '@/shared/lib/openMiniAppStore'

export default defineUiLocation({
  id: 'mini-app-store.open',
  uri: 'localix://ui/work-item/mini-app-store',
  title: 'Mini app store',
  description: 'Add, update and remove mini apps from the catalogs',
  agent: { description: 'Open the mini app store, where the person adds and updates mini apps' },
  keywords: ['mini apps', 'store', 'catalog', 'install', 'add', 'update'],
  group: 'Application',
  Icon: LayoutGrid,
  effect: 'read',
  surface: 'work-item',
  exposure: { search: true, palette: true },
  resolve: () => ({
    kind: 'work-item',
    workKind: MINI_APP_STORE_KIND,
    id: MINI_APP_STORE_KIND,
    title: 'Mini apps',
  }),
})
