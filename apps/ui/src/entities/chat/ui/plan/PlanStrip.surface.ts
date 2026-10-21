import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.composer.plan',
  title: 'Plan strip',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Opens, approves, sends review comments on, or dismisses the plan the agent presented.',
})
