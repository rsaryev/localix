import { SquareTerminal } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export const COMMAND_PALETTE_OVERLAY_ID = 'command-palette'

export default defineUiLocation({
  id: 'commands.palette.open',
  uri: 'localix://ui/overlay/command-palette',
  title: 'Command palette',
  description: 'Search available workspace commands',
  agent: { description: 'Search available workspace commands' },
  keywords: ['actions', 'commands', 'run'],
  group: 'Navigation',
  Icon: SquareTerminal,
  effect: 'read',
  surface: 'overlay',
  params: {
    query: {
      type: 'string',
      description: 'Optional initial command search text.',
      optional: true,
      allowEmpty: true,
      maxLength: 256,
    },
  },
  exposure: { search: true, palette: false },
  resolve: ({ query }) => ({
    kind: 'overlay',
    overlayId: COMMAND_PALETTE_OVERLAY_ID,
    ...(query === undefined ? {} : { params: { query } }),
  }),
})
