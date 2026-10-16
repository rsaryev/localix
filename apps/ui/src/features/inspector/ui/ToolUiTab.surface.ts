import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.tools.ui-tab',
  title: 'Tool UI tab renderer',
  surface: 'plugin',
  effect: 'write',
  exposure: {},
  reason: 'Requires trusted tool-call HTML and data supplied by an existing work item.',
})
