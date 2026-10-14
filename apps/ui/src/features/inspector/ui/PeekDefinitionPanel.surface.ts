import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.editor.peek-definition',
  title: 'Peek definition panel',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Requires an editor position and language-service result from its owner.',
})
