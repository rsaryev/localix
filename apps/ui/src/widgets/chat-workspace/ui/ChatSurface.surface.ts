import { MessageSquare } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export default defineUiLocation({
  id: 'chat.open',
  uri: 'localix://ui/work-item/chat',
  title: 'Chat',
  description: 'Open a chat session',
  agent: { description: 'Open a chat session' },
  keywords: ['conversation', 'session', 'messages'],
  group: 'Navigation',
  Icon: MessageSquare,
  effect: 'read',
  surface: 'work-item',
  params: {
    session: {
      type: 'string',
      description: 'Existing chat session id supplied by Localix context.',
      maxLength: 256,
    },
  },
  exposure: { search: false, palette: false },
  present: ({ session }) => ({ label: `Open chat ${session}` }),
  resolve: ({ session }) => ({ kind: 'session', sessionId: session }),
})
