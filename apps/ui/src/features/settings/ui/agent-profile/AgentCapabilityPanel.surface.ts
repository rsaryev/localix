import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.settings.agent-capability-panel',
  title: 'Agent capability tabs',
  surface: 'settings',
  effect: 'write',
  exposure: {},
  reason:
    'The capability tabs of one agent profile; the profile owns the address and passes the agent down.',
})
