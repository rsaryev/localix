import { createBrandScenes } from './brand-scenes'
import { createBlackoutScenes, createNightfallScenes } from './dark-scenes'
import { createSpatialRelay } from './cinematic-templates'
import {
  createOrbitScenes,
  createTypePlayScenes,
  createDaylightScenes,
  createConnectScenes,
  createMomentumScenes,
  createOffbeatScenes,
  createFieldNotesScenes,
} from './refined-scenes'
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
      'A camera study: a tactile app dock, a close-up of the product and a wide pullback.',
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
    description: 'Large dimensional type, camera accents and punchy cuts.',
  },
  social: {
    name: 'Daylight',
    category: 'Social',
    description: 'A warm vertical collection: separate thoughts become one composition.',
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
    description: 'Folded planes, lilac depth and a quiet brand reveal.',
  },
  event: {
    name: 'Offbeat',
    category: 'Events',
    description: 'Oversized poster type, sharp camera moves and a clean festival sign-off.',
  },
  editorial: {
    name: 'Field notes',
    category: 'Editorial',
    description: 'A serif editorial page, a tracked document handoff and a measured pullback.',
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
    relay: createSpatialRelay,
    nightfall: createNightfallScenes,
    launch: createOrbitScenes,
    kinetic: createTypePlayScenes,
    social: createDaylightScenes,
    explainer: createConnectScenes,
    report: createMomentumScenes,
    identity: createBrandScenes,
    event: createOffbeatScenes,
    editorial: createFieldNotesScenes,
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
