import { BookMarked } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { STORE_KIND } from '@/shared/lib/openStore'

function host(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' ? 'a folder on this computer' : parsed.host
  } catch {
    return url
  }
}

/**
 * `localix://ui/work-item/mini-app-store/add-catalog?url=<address>`: a publisher's link to their
 * catalog. It opens the Store's sources with the add dialog filled in, which reads the catalog first; the
 * catalog is kept only when the person chooses Add, so following the link changes nothing.
 */
export default defineUiLocation({
  id: 'mini-app-store.add-catalog',
  uri: 'localix://ui/work-item/mini-app-store/add-catalog',
  title: 'Add a mini app catalog',
  description: 'Open the Store to add a publisher’s catalog by its address',
  agent: {
    description:
      'Open the Store’s Add source dialog filled with a catalog address the person gave you; ' +
      'it reads the catalog first, and only the person’s Add keeps it',
  },
  keywords: ['mini apps', 'catalog', 'publisher', 'add'],
  group: 'Application',
  Icon: BookMarked,
  effect: 'read',
  surface: 'work-item',
  params: {
    url: {
      type: 'string',
      description: 'The catalog’s mini-app-catalog.json address: https:// or file://.',
      maxLength: 2_048,
    },
  },
  exposure: { search: false, palette: false },
  present: ({ url }) => ({
    label: `Add the catalog at ${host(url)}`,
    description: 'Opens the Store to read it first; nothing is added until you choose Add',
  }),
  resolve: ({ url }) => ({
    kind: 'work-item',
    workKind: STORE_KIND,
    id: STORE_KIND,
    title: 'Store',
    payload: { shelf: 'sources', addSource: { kind: 'mini-app', input: url } },
  }),
})
