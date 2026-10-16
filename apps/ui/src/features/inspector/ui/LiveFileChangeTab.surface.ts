import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.editor.live-file-change',
  title: 'Live file change tab',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Displays one active tool-call mutation stream identified by its owning work item.',
})
