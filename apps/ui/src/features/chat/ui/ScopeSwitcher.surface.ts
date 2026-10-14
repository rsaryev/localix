import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.chat.scope-switcher',
  title: 'Chat scope switcher',
  surface: 'picker',
  effect: 'read',
  exposure: {},
  reason: 'Embedded in chat navigation and depends on the current project and session scope.',
})
