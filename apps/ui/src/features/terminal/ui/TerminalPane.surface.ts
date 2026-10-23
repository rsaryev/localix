import { SquareTerminal } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export default defineUiLocation({
  id: 'terminal.open',
  uri: 'localix://ui/work-item/terminal',
  title: 'Terminal',
  description: 'Reveal or create a workspace terminal',
  agent: { description: 'Reveal or create a workspace terminal' },
  keywords: ['shell', 'console', 'pty'],
  group: 'Application',
  Icon: SquareTerminal,
  effect: 'read',
  surface: 'work-item',
  params: {
    session: {
      type: 'string',
      description: 'Optional chat session id whose terminal should be revealed.',
      optional: true,
      maxLength: 256,
    },
    mode: {
      type: 'string',
      description: 'Reuse an available terminal or explicitly create a new one.',
      optional: true,
      values: ['reuse', 'new'],
    },
  },
  exposure: { search: true },
  present: ({ mode }) => ({
    label: mode === 'new' ? 'Open a new terminal' : 'Open terminal',
  }),
  resolve: ({ session, mode }) => ({
    kind: 'inspector',
    target: 'terminal',
    sessionId: session,
    terminalMode: mode === 'new' || mode === 'reuse' ? mode : undefined,
  }),
})
