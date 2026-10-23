import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.external.history-sidebar',
  title: 'External history',
  surface: 'sidebar',
  effect: 'read',
  exposure: {},
  reason:
    'The External source of chat history, reused inside a resource container tab; the source tabs own entry.',
})
