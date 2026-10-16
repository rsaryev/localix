import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.composer.questions',
  title: 'Questions panel',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Answers or skips the questions the agent queued for the current chat composer.',
})
