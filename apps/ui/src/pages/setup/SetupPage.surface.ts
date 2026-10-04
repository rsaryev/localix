import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.routes.setup-page',
  title: 'Setup route page',
  surface: 'page',
  effect: 'write',
  exposure: {},
  reason: 'The router owns setup lifecycle and its stateful onboarding context.',
})
