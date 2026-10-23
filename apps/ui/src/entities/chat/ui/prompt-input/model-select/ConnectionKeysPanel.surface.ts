import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.connection-keys',
  title: 'Connection keys panel',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Edits provider credentials inside the owning connection workflow.',
})
