import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.editor.file-editor-picker',
  title: 'File editor picker',
  surface: 'picker',
  effect: 'read',
  exposure: {},
  reason: 'Chooses among editors matched for the active file work item.',
})
