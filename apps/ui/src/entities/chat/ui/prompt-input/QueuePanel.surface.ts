import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.composer.queue-items',
  title: 'Prompt queue panel',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Manages queued prompts for one mounted composer and has no independent identity.',
})
