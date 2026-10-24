import { Store } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { STORE_KIND } from '@/shared/lib/openStore'

export default defineUiLocation({
  id: 'store.open',
  uri: 'localix://ui/work-item/store',
  title: 'Store',
  description: 'Find, install, update and remove mini apps and other packages',
  agent: {
    description: 'Open the Store, where the person installs, updates and removes packages',
  },
  keywords: ['store', 'install', 'add', 'update', 'packages', 'mini apps', 'sources'],
  group: 'Application',
  Icon: Store,
  effect: 'read',
  surface: 'work-item',
  // A Store search hit names one listing: the Store opens on its page.
  params: {
    kind: {
      type: 'string',
      optional: true,
      maxLength: 32,
      description: 'The package kind of the listing to open.',
    },
    id: {
      type: 'string',
      optional: true,
      maxLength: 512,
      description: 'The listing id within its kind.',
    },
  },
  exposure: { search: true, palette: true },
  resolve: ({ kind, id }) => ({
    kind: 'work-item',
    workKind: STORE_KIND,
    id: STORE_KIND,
    title: 'Store',
    payload: kind && id ? { ref: { kind, id } } : {},
  }),
})
