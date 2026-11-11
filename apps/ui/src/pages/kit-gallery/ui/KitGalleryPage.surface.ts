import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.routes.kit-gallery-page',
  title: 'Kit gallery route page',
  surface: 'page',
  effect: 'read',
  exposure: {},
  reason: 'A development route owned by the router rather than a user-facing UI destination.',
})
