import { ListTree } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export const DOCUMENT_SYMBOL_OVERLAY_ID = 'document-symbol'

export default defineUiLocation({
  id: 'symbols.document.open',
  uri: 'localix://ui/picker/document-symbol',
  title: 'Go to symbol in file',
  description: 'Open symbols for the current file',
  agent: { description: 'Open symbols for the current file' },
  keywords: ['outline', 'method', 'class', 'function'],
  group: 'Navigation',
  Icon: ListTree,
  effect: 'read',
  surface: 'picker',
  params: {
    query: {
      type: 'string',
      description: 'Optional initial symbol search text for the active file.',
      optional: true,
      allowEmpty: true,
      maxLength: 256,
    },
  },
  exposure: { search: true, palette: true },
  resolve: ({ query }) => ({
    kind: 'overlay',
    overlayId: DOCUMENT_SYMBOL_OVERLAY_ID,
    ...(query === undefined ? {} : { params: { query } }),
  }),
})
