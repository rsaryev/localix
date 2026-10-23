import { History } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export default defineUiLocation({
  id: 'snapshot.open',
  uri: 'localix://ui/work-item/snapshot',
  title: 'Activity',
  description: 'Open tool activity and sources for a chat message',
  agent: { description: 'Open the tool activity and sources for a chat message' },
  keywords: ['message', 'tools', 'replay', 'activity', 'sources', 'evidence'],
  group: 'Application',
  Icon: History,
  effect: 'read',
  surface: 'work-item',
  params: {
    session: {
      type: 'string',
      description: 'Chat session id containing the message.',
      maxLength: 256,
    },
    message: {
      type: 'string',
      description: 'Message id whose tool activity should be shown.',
      maxLength: 256,
    },
  },
  exposure: { search: false, palette: false },
  resolve: ({ session, message }) => ({
    kind: 'inspector',
    target: 'message-replay',
    sessionId: session,
    messageId: message,
  }),
})
