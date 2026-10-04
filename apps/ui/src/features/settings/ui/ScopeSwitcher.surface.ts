import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.settings.scope-switcher',
  title: 'Settings scope switcher',
  surface: 'picker',
  effect: 'read',
  exposure: {},
  reason: 'Switches the scope of its owning settings panel and is not a destination itself.',
})
