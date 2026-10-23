import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.editor.media-file',
  title: 'Media file tab',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Requires an already resolved media id and file payload.',
})
