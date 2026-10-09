import { sceneSchema, type MotionScene } from './schema'

const shot = (layout: MotionScene['layout'], headline: string, rest: Partial<MotionScene> = {}) =>
  sceneSchema.parse({ id: crypto.randomUUID(), layout, headline, transition: 'cut', ...rest })

export function createBlackoutScenes() {
  return [
    shot('hook', 'Too much\nnoise.', { duration: 3, body: 'Make space for what matters.' }),
    shot('wordmark', 'Make\nroom.', { duration: 2.5 }),
    shot('focus', 'One clear\nidea.', {
      duration: 3.5,
      body: 'A little focus changes everything.',
    }),
    shot('hook', 'Say it\nlouder.', { duration: 2.5 }),
    shot('wordmark', 'Blackout.', { duration: 3.5, body: 'A typography study', label: 'BLACKOUT' }),
  ]
}

export function createRelayScenes() {
  return [
    shot('hook', 'Ideas.\nConnected.', {
      duration: 3,
      body: 'From the first spark to the next move.',
    }),
    shot('focus', 'Everything.\nIn one flow.', {
      duration: 4.5,
      label: 'Relay',
      items: ['Collect', 'Connect', 'Create'],
      body: 'An illustrative product canvas. Make it your own.',
    }),
    shot('wordmark', 'Less friction.\nMore flow.', { duration: 3 }),
    shot('focus', 'Your next\nmove.', {
      duration: 4,
      label: 'Relay',
      items: ['Idea', 'In motion', 'Ready'],
      body: 'One place to move things forward.',
    }),
    shot('wordmark', 'Relay.', { duration: 3.5, label: 'RELAY', body: 'A fictional product film' }),
  ]
}

export function createNightfallScenes() {
  return [
    shot('wordmark', 'Quietly\nbold.', { duration: 4, body: 'Presence without the noise.' }),
    shot('focus', 'A different\nperspective.', { duration: 4.5, transition: 'wipe' }),
    shot('hook', 'Leave an\nimpression.', {
      duration: 3.5,
      body: 'Small gestures. A lasting feeling.',
    }),
    shot('wordmark', 'Nightfall.', {
      duration: 4.5,
      body: 'An independent brand study',
      label: 'NIGHTFALL',
    }),
  ]
}
