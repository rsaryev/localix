import { MessagesSquare } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export const SESSION_SWITCHER_OVERLAY_ID = 'session-switcher'

export default defineUiLocation({
  id: 'sessions.switcher.open',
  uri: 'localix://ui/picker/session-switcher',
  title: 'Switch chat',
  description: 'Open the chat session picker',
  agent: { description: 'Open the chat session picker' },
  keywords: ['history', 'conversation', 'recent'],
  group: 'Navigation',
  Icon: MessagesSquare,
  effect: 'read',
  surface: 'picker',
  exposure: { search: true, palette: true },
  resolve: () => ({ kind: 'overlay', overlayId: SESSION_SWITCHER_OVERLAY_ID }),
})
