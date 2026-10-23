import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.search.palette',
  title: 'Global search palette',
  surface: 'picker',
  effect: 'read',
  exposure: {},
  reason: 'Embedded presentation of the addressable global-search surface.',
})
