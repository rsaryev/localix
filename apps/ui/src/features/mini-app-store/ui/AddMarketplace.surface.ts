import { BookMarked } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { STORE_KIND } from '@/shared/lib/openStore'

/** What the link names: a GitHub repository as written, else the address's host. */
function named(input: string): string {
  try {
    const parsed = new URL(input)
    return parsed.protocol === 'file:' ? 'in a folder on this computer' : `at ${parsed.host}`
  } catch {
    return input
  }
}

/**
 * `localix://ui/work-item/mini-app-store/add-marketplace?url=<owner/repo or address>`: a keeper's
 * link to their mini app marketplace. It opens the Store's sources with the add dialog filled in,
 * which reads the marketplace first; it is kept only when the person chooses Add, so following
 * the link changes nothing.
 */
export default defineUiLocation({
  id: 'mini-app-store.add-marketplace',
  uri: 'localix://ui/work-item/mini-app-store/add-marketplace',
  title: 'Add a mini app marketplace',
  description: 'Open the Store to add a mini app marketplace by its GitHub repository or address',
  agent: {
    description:
      'Open the Store’s Add source dialog filled with a mini app marketplace the person gave you ' +
      '(a GitHub owner/repo, or the address of its mini-app-marketplace.json); it reads the ' +
      'marketplace first, and only the person’s Add keeps it',
  },
  keywords: ['mini apps', 'marketplace', 'publisher', 'add'],
  group: 'Application',
  Icon: BookMarked,
  effect: 'read',
  surface: 'work-item',
  params: {
    url: {
      type: 'string',
      description:
        'The marketplace: a GitHub owner/repo, or its mini-app-marketplace.json at https:// or file://.',
      maxLength: 2_048,
    },
  },
  exposure: { search: false, palette: false },
  present: ({ url }) => ({
    label: `Add the marketplace ${named(url)}`,
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
