import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.chat.runtime-sessions',
  title: 'Runtime sessions panel',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Rendered inside chat diagnostics and requires its owning runtime-session state.',
})
