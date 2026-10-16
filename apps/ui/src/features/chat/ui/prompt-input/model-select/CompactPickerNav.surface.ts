import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.compact-picker-nav',
  title: 'Compact model picker navigation',
  surface: 'picker',
  effect: 'write',
  exposure: {},
  reason: 'Switches workload and provider columns inside the owning model picker.',
})
