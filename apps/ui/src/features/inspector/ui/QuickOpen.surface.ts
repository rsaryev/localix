import { FileSearch } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export const QUICK_OPEN_OVERLAY_ID = 'quick-open'

export default defineUiLocation({
  id: 'quick-open.open',
  uri: 'localix://ui/picker/quick-open',
  title: 'Go to file',
  description: 'Open the workspace file picker',
  agent: { description: 'Open the workspace file picker' },
  keywords: ['files', 'fuzzy', 'quick open'],
  group: 'Navigation',
  Icon: FileSearch,
  effect: 'read',
  surface: 'picker',
  params: {
    query: {
      type: 'string',
      description: 'Optional initial file-name search text.',
      optional: true,
      allowEmpty: true,
      maxLength: 512,
    },
  },
  exposure: { search: true, palette: true },
  present: ({ query }) => ({ label: query ? `Find file “${query}”` : 'Go to file' }),
  resolve: ({ query }) => ({
    kind: 'overlay',
    overlayId: QUICK_OPEN_OVERLAY_ID,
    ...(query === undefined ? {} : { params: { query } }),
  }),
})
