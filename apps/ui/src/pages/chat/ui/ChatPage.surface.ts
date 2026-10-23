import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.routes.chat-page',
  title: 'Chat route page',
  surface: 'page',
  effect: 'read',
  exposure: {},
  reason: 'Addressed by the application router with project and session path state.',
})
