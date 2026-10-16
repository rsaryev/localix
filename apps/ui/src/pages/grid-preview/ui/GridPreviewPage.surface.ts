import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.routes.grid-preview-page',
  title: 'Grid preview route page',
  surface: 'page',
  effect: 'read',
  exposure: {},
  reason: 'A development route owned by the router rather than a user-facing UI destination.',
})
