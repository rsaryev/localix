import { Search } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export const MESSAGE_SEARCH_OVERLAY_ID = 'message-search'

export default defineUiLocation({
  id: 'chat.find.open',
  uri: 'localix://ui/overlay/message-search',
  title: 'Find in chat',
  description: 'Search within the current conversation',
  agent: { description: 'Search within the current conversation' },
  keywords: ['messages', 'conversation', 'find'],
  group: 'Navigation',
  Icon: Search,
  effect: 'read',
  surface: 'overlay',
  params: {
    query: {
      type: 'string',
      description: 'Optional initial text to find in the current conversation.',
      optional: true,
      allowEmpty: true,
      maxLength: 512,
    },
  },
  exposure: { search: true, palette: true },
  present: ({ query }) => ({ label: query ? `Find “${query}” in chat` : 'Find in chat' }),
  resolve: ({ query }) => ({
    kind: 'overlay',
    overlayId: MESSAGE_SEARCH_OVERLAY_ID,
    ...(query === undefined ? {} : { params: { query } }),
  }),
})
