import { filmShot as shot } from './film-shot'

export function createBlackoutScenes() {
  return [
    shot('hook', 'Too much\nnoise.', { duration: 3, body: 'Make space for what matters.' }),
    shot('typeset', 'Make\nroom.', { duration: 2.5 }),
    shot('focus', 'One clear\nidea.', {
      duration: 3.5,
      body: 'A little focus changes everything.',
    }),
    shot('hook', 'Say it\nlouder.', { duration: 2.5 }),
    shot('typeset', 'Blackout.', { duration: 3, body: 'A typography study' }),
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
    }),
  ]
}
