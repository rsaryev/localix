import { LayoutGrid } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { STORE_KIND } from '@/shared/lib/openStore'

export default defineUiLocation({
  id: 'mini-app-store.open',
  uri: 'localix://ui/work-item/mini-app-store',
  title: 'Mini app store',
  description: 'The Store on its Mini apps shelf: add, update and remove mini apps',
  agent: { description: 'Open the Store on its Mini apps shelf, where the person adds mini apps' },
  keywords: ['mini apps', 'store', 'marketplace', 'install', 'add', 'update'],
  group: 'Application',
  Icon: LayoutGrid,
  effect: 'read',
  surface: 'work-item',
  exposure: { search: true, palette: true },
  resolve: () => ({
    kind: 'work-item',
    workKind: STORE_KIND,
    id: STORE_KIND,
    title: 'Store',
    payload: { shelf: 'package:mini-app' },
  }),
})
