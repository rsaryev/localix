import { Braces } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export const WORKSPACE_SYMBOL_OVERLAY_ID = 'workspace-symbol'

export default defineUiLocation({
  id: 'symbols.workspace.open',
  uri: 'localix://ui/picker/workspace-symbol',
  title: 'Go to symbol in workspace',
  description: 'Search symbols across the current workspace',
  agent: { description: 'Search symbols across the current workspace' },
  keywords: ['lsp', 'method', 'class', 'function'],
  group: 'Navigation',
  Icon: Braces,
  effect: 'read',
  surface: 'picker',
  params: {
    query: {
      type: 'string',
      description: 'Optional initial symbol search text for the current workspace.',
      optional: true,
      allowEmpty: true,
      maxLength: 256,
    },
  },
  exposure: { search: true, palette: true },
  resolve: ({ query }) => ({
    kind: 'overlay',
    overlayId: WORKSPACE_SYMBOL_OVERLAY_ID,
    ...(query === undefined ? {} : { params: { query } }),
  }),
})
