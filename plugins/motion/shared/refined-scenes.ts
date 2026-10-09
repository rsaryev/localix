import { cameraTrack } from './camera-presets'
import { filmShot as shot } from './film-shot'

export function createOrbitScenes() {
  return [
    shot('token', 'Room for\nwhat’s next.', {
      duration: 3.5,
      camera: cameraTrack(3.5, [
        { at: 0, x: 0.05, z: 1.3 },
        { at: 0.24, x: 0.12, z: 0.64, easing: 'out' },
        { at: 0.68, x: 0, z: 1.5 },
        { at: 0.86, z: 1.6 },
      ]),
    }),
    shot('product', 'One place.\nMore possibility.', {
      body: 'Your ideas, brought together.',
      label: 'Orbit',
      duration: 3.5,
    }),
    shot('steps', 'From thought\nto momentum.', {
      items: ['Collect', 'Connect', 'Create'],
      duration: 3.5,
    }),
    shot('typeset', 'Make your\nnext move.', {
      body: 'A fictional product study',
      duration: 3,
    }),
  ]
}
export function createTypePlayScenes() {
  return [
    shot('typeset', 'MAKE\nSOME\nNOISE.', { duration: 2.5 }),
    shot('typeset', 'Move.', {
      palette: 'ink',
      duration: 1.5,
      camera: cameraTrack(1.5, [
        { at: 0, z: 1.65, x: -0.2 },
        { at: 0.72, z: 0.92, x: 0, easing: 'out' },
      ]),
    }),
    shot('typeset', 'BREAK\nTHE\nPATTERN.', { palette: 'ember', duration: 2.5 }),
    shot('typeset', 'YOUR\nNEXT\nIDEA.', { body: 'Give it a little room to move.', duration: 3 }),
  ]
}
export function createDaylightScenes() {
  return [
    shot('gather', 'Good things.\nSmall details.\nBig feeling.', {
      duration: 8,
      items: ['A brighter day', 'A small detail', 'A new feeling'],
      body: 'An illustrative collection',
      camera: cameraTrack(8, [
        { at: 0, z: 1.6, roll: -3 },
        { at: 0.3, z: 1.4, roll: 2 },
        { at: 0.6, z: 1.15, roll: 0 },
        { at: 0.88, z: 1.35 },
      ]),
    }),
    shot('typeset', 'Find your\nsunny side.', { duration: 3, body: 'Explore the collection' }),
  ]
}
export function createConnectScenes() {
  return [
    shot('gather', 'Find the question.\nJoin the dots.\nMake the next step.', {
      duration: 8,
      items: ['An idea', 'An insight', 'A direction'],
      camera: cameraTrack(8, [
        { at: 0, x: -0.1, z: 1.7, roll: -2 },
        { at: 0.32, x: 0.12, z: 1.55, roll: 2 },
        { at: 0.65, x: 0, z: 1.3, roll: 0 },
        { at: 0.88, z: 1.55 },
      ]),
    }),
    shot('typeset', 'See the\nconnection.', { duration: 3, body: 'An illustrative explainer' }),
  ]
}
export function createMomentumScenes() {
  return [
    shot('typeset', 'A YEAR\nIN\nMOTION.', { duration: 2.5 }),
    shot('chart', 'A small change.\nA bigger story.', {
      value: 72,
      suffix: '%',
      duration: 5,
      palette: 'paper',
      series: [
        { label: 'Q1', value: 31 },
        { label: 'Q2', value: 42 },
        { label: 'Q3', value: 60 },
        { label: 'Q4', value: 72 },
      ],
      body: 'Illustrative figures — replace with verified data.',
      camera: cameraTrack(5, [
        { at: 0, x: 0.17, z: 1.45, yaw: 3 },
        { at: 0.45, x: 0, z: 1.65, yaw: 0 },
        { at: 0.84, z: 1.7 },
      ]),
    }),
    shot('steps', 'What builds\nmomentum?', {
      items: ['A clear direction', 'Steady progress', 'A shared goal'],
      duration: 3.5,
    }),
    shot('typeset', 'On to the\nnext chapter.', {
      body: 'An illustrative annual review',
      palette: 'paper',
      duration: 3,
    }),
  ]
}
export function createOffbeatScenes() {
  return [
    shot('typeset', 'OFF\nBEAT.', { duration: 2.5, body: 'Sound, art & everything between' }),
    shot('typeset', 'FIND\nYOUR\nFREQUENCY.', {
      palette: 'ink',
      duration: 2.5,
      camera: cameraTrack(2.5, [
        { at: 0, z: 1.5, roll: -7 },
        { at: 0.6, z: 1.15, roll: 0, easing: 'out' },
        { at: 0.84, z: 1.3 },
      ]),
    }),
    shot('typeset', 'COME\nAS YOU\nARE.', {
      duration: 2.5,
      body: 'Three nights. A thousand possibilities.',
    }),
    shot('typeset', 'OFFBEAT\n18—20\nJULY.', {
      duration: 3,
      body: 'A fictional event-poster study',
    }),
  ]
}
export function createFieldNotesScenes() {
  return [
    shot('portfolio', 'A different\nkind of pace.', {
      duration: 8,
      label: 'Field notes',
      body: 'Space, rhythm, and a new perspective.',
      camera: cameraTrack(8, [
        { at: 0, y: -0.32, z: 0.9, roll: -3 },
        { at: 0.23, y: -0.24, z: 0.8 },
        { at: 0.47, x: -0.05, y: 0.23, z: 0.85, roll: 0 },
        { at: 0.7, x: 0, y: 0.06, z: 1.5 },
        { at: 0.9, z: 1.95 },
      ]),
    }),
    shot('typeset', 'Field\nnotes.', {
      typeface: 'serif',
      body: 'A fictional editorial motion study',
      duration: 3,
    }),
  ]
}
