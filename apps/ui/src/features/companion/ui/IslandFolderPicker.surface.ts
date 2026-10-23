import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.companion.folder-picker',
  title: 'Island folder picker',
  surface: 'picker',
  effect: 'read',
  exposure: {},
  reason: 'Embedded in the island toolbar and depends on the island’s current request.',
})
