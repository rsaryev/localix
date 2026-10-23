import { History } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export default defineUiLocation({
  id: 'chat.history.open',
  uri: 'localix://ui/sidebar/history',
  title: 'Chat history',
  description: 'Open the chat history sidebar',
  agent: { description: 'Open the chat history sidebar' },
  keywords: ['sessions', 'conversations', 'recent'],
  group: 'Navigation',
  Icon: History,
  effect: 'read',
  surface: 'sidebar',
  exposure: { search: true, palette: true },
  resolve: () => ({ kind: 'rail-section', sectionId: null }),
})
