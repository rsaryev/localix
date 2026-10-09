import { createBrandScenes } from './brand-scenes'
import { createBlackoutScenes, createNightfallScenes, createRelayScenes } from './dark-scenes'
import {
  documentSchema,
  sceneSchema,
  type MotionScene,
  type MotionDocument,
  type TemplateId,
} from './schema'

export const templates: Record<
  TemplateId,
  { name: string; category: string; description: string }
> = {
  blackout: {
    name: 'Blackout',
    category: 'Typography',
    description:
      'Oversized type, a measured grid and sharp hooks. A monochrome film with room to breathe.',
  },
  relay: {
    name: 'Relay',
    category: 'Product',
    description:
      'A bold opening becomes a precise product reveal. Cool light, fine frames and connected ideas.',
  },
  nightfall: {
    name: 'Nightfall',
    category: 'Brand',
    description:
      'Warm graphite, opening apertures and slow typography. A quiet, cinematic brand signature.',
  },
  launch: {
    name: 'Orbit',
    category: 'Product',
    description: 'A sculptural opening, product close-up and a confident sign-off.',
  },
  kinetic: {
    name: 'Type play',
    category: 'Typography',
    description: 'Elastic letters, diagonal ribbons and punchy cuts.',
  },
  social: {
    name: 'Daylight',
    category: 'Social',
    description: 'A warm vertical campaign with bold type and a playful graphic.',
  },
  explainer: {
    name: 'Connect',
    category: 'Explainer',
    description: 'An idea becomes a sequence: connect, build, resolve.',
  },
  report: {
    name: 'Momentum',
    category: 'Data',
    description: 'Large figures meet rising bars and a change of register.',
  },
  identity: {
    name: 'Soft signal',
    category: 'Brand',
    description: 'Interlocking geometry, lilac space and a quiet brand reveal.',
  },
  event: {
    name: 'Offbeat',
    category: 'Events',
    description: 'A rotating rosette, oversized type and festival-poster energy.',
  },
  editorial: {
    name: 'Field notes',
    category: 'Editorial',
    description: 'Serif headlines, moving print forms and measured pacing.',
  },
  blank: {
    name: 'Untitled video',
    category: 'Custom',
    description: 'An empty scene for your own layers and motion.',
  },
}
const scene = (layout: MotionScene['layout'], headline: string, rest: Partial<MotionScene> = {}) =>
  sceneSchema.parse({ id: crypto.randomUUID(), layout, headline, ...rest })

export function createTemplateDocument(
  template: TemplateId,
  title = templates[template].name,
): MotionDocument {
  const scenes: Record<TemplateId, () => MotionScene[]> = {
    blackout: createBlackoutScenes,
    relay: createRelayScenes,
    nightfall: createNightfallScenes,
    launch: () => [
      scene('orbit', 'Room for\nwhat’s next.', { label: 'Orbit / product film', duration: 3.5 }),
      scene('product', 'One place.\nMore possibility.', {
        body: 'Your ideas, brought together.',
        label: 'Orbit',
        duration: 4.5,
      }),
      scene('steps', 'From thought\nto momentum.', {
        items: ['Collect', 'Connect', 'Create'],
        palette: 'citrus',
        duration: 4,
      }),
      scene('orbit', 'Make your\nnext move.', {
        label: 'Orbit',
        body: 'A fictional product study',
        duration: 3.5,
        transition: 'wipe',
      }),
    ],
    kinetic: () => [
      scene('ribbon', 'MAKE\nSOME\nNOISE.', {
        label: 'Type play / a motion study',
        duration: 2.5,
        transition: 'cut',
      }),
      scene('kinetic', 'Move.', { palette: 'ink', duration: 1.5, transition: 'cut' }),
      scene('poster', 'BREAK\nTHE\nPATTERN.', {
        palette: 'ember',
        duration: 2.5,
        transition: 'cut',
      }),
      scene('ribbon', 'YOUR\nNEXT\nIDEA.', {
        body: 'Give it a little room to move.',
        duration: 3.5,
        transition: 'wipe',
      }),
    ],
    social: () => [
      scene('poster', 'GOOD\nTHINGS\nAHEAD.', {
        label: 'Daylight / studio collection',
        duration: 3,
      }),
      scene('product', 'A brighter\neveryday.', {
        body: 'A fictional collection. Add your own product image.',
        duration: 4,
      }),
      scene('ribbon', 'SMALL\nDETAILS.\nBIG FEELING.', {
        palette: 'ember',
        duration: 3,
        transition: 'cut',
      }),
      scene('editorial', 'Find your\nsunny side.', {
        body: 'Explore the collection',
        duration: 3.5,
      }),
    ],
    explainer: () => [
      scene('orbit', 'Ideas work\nbetter together.', {
        label: 'Connect / an idea in motion',
        duration: 3.5,
      }),
      scene('steps', 'Three moves.\nOne clear idea.', {
        items: ['Find the question', 'Join the dots', 'Make the next step'],
        duration: 5,
      }),
      scene('ribbon', 'LESS\nNOISE.\nMORE CLARITY.', {
        palette: 'paper',
        duration: 3,
        transition: 'cut',
      }),
      scene('orbit', 'See the\nconnection.', { body: 'An illustrative explainer', duration: 3.5 }),
    ],
    report: () => [
      scene('ribbon', 'A YEAR\nIN\nMOTION.', {
        label: 'Momentum / illustrative data',
        duration: 3,
        transition: 'cut',
      }),
      scene('bars', 'A small change.\nA bigger story.', {
        value: 72,
        suffix: '%',
        series: [
          { label: 'Q1', value: 31 },
          { label: 'Q2', value: 42 },
          { label: 'Q3', value: 60 },
          { label: 'Q4', value: 72 },
        ],
        body: 'Illustrative figures and bars — replace with verified data.',
        duration: 5,
        palette: 'paper',
      }),
      scene('steps', 'What builds\nmomentum?', {
        items: ['A clear direction', 'Steady progress', 'A shared goal'],
        duration: 4,
      }),
      scene('editorial', 'On to the\nnext chapter.', {
        body: 'An illustrative annual review',
        palette: 'paper',
        duration: 3.5,
      }),
    ],
    identity: createBrandScenes,
    event: () => [
      scene('poster', 'OFF\nBEAT.', {
        label: 'Sound, art & everything between',
        body: 'An imaginary festival / 18–20 July',
        duration: 3.5,
      }),
      scene('ribbon', 'FIND\nYOUR\nFREQUENCY.', {
        palette: 'ink',
        duration: 2.5,
        transition: 'cut',
      }),
      scene('poster', 'COME\nAS YOU\nARE.', {
        body: 'Three nights. A thousand possibilities.',
        duration: 3.5,
        transition: 'cut',
      }),
      scene('ribbon', 'OFFBEAT\n18—20\nJULY.', {
        body: 'A fictional event-poster study',
        duration: 3.5,
        transition: 'wipe',
      }),
    ],
    editorial: () => [
      scene('editorial', 'A different\nkind of pace.', {
        label: 'Field notes / a moving journal',
        duration: 4,
      }),
      scene('editorial', 'Notice\nthe little\nthings.', {
        palette: 'rose',
        body: 'Space, rhythm, and a new perspective.',
        duration: 4.5,
        transition: 'wipe',
      }),
      scene('orbit', 'Take the\nlong way.', { palette: 'ink', duration: 3.5 }),
      scene('editorial', 'Field\nnotes.', {
        body: 'A fictional editorial motion study',
        duration: 4,
      }),
    ],
    blank: () => [scene('custom', '', { duration: 4 })],
  }
  const palette: Record<TemplateId, MotionDocument['palette']> = {
    blackout: 'noir',
    relay: 'noir',
    nightfall: 'graphite',
    launch: 'ink',
    kinetic: 'citrus',
    social: 'rose',
    explainer: 'cobalt',
    report: 'ink',
    identity: 'electric',
    event: 'ember',
    editorial: 'paper',
    blank: 'ink',
  }
  return documentSchema.parse({
    schemaVersion: 1,
    title,
    template,
    format: template === 'social' || template === 'event' ? 'portrait' : 'landscape',
    palette: palette[template],
    scenes: scenes[template](),
  })
}
