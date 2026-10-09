import { z } from 'zod'

export const idSchema = z.string().uuid()
export const layouts = [
  'title',
  'kinetic',
  'product',
  'cards',
  'stat',
  'quote',
  'logo',
  'poster',
  'ribbon',
  'orbit',
  'editorial',
  'steps',
  'bars',
  'hook',
  'focus',
  'wordmark',
  'custom',
] as const
export const paletteIds = [
  'ink',
  'paper',
  'cobalt',
  'citrus',
  'rose',
  'ember',
  'electric',
  'noir',
  'graphite',
] as const
export const formatIds = ['landscape', 'portrait', 'square'] as const
export const templateIds = [
  'blackout',
  'relay',
  'nightfall',
  'launch',
  'kinetic',
  'social',
  'explainer',
  'report',
  'identity',
  'event',
  'editorial',
  'blank',
] as const
export const keyframeSchema = z.strictObject({
  time: z.number().min(0).max(20),
  x: z.number().min(-2).max(3),
  y: z.number().min(-2).max(3),
  scale: z.number().min(0).max(10).default(1),
  rotation: z.number().min(-720).max(720).default(0),
  opacity: z.number().min(0).max(1).default(1),
  easing: z.enum(['linear', 'smooth', 'out', 'spring']).default('out'),
})
export const layerSchema = z.strictObject({
  id: idSchema,
  kind: z.enum([
    'text',
    'rectangle',
    'circle',
    'image',
    'ring',
    'rosette',
    'orbit',
    'line',
    'grid',
    'frame',
  ]),
  text: z.string().max(400).default(''),
  color: z.enum(['foreground', 'background', 'accent', 'muted']).default('foreground'),
  width: z.number().min(0.01).max(2).default(0.4),
  height: z.number().min(0.01).max(2).default(0.2),
  fontSize: z.number().min(0.01).max(0.3).default(0.08),
  assetId: idSchema.nullable().default(null),
  keyframes: z
    .array(keyframeSchema)
    .min(1)
    .max(40)
    .refine(
      (frames) =>
        frames.every((frame, index) => index === 0 || frame.time > frames[index - 1]!.time),
      'Keyframe times must increase.',
    ),
})
export const sceneSchema = z.strictObject({
  id: idSchema,
  layout: z.enum(layouts),
  headline: z.string().trim().max(180),
  body: z.string().max(600).default(''),
  label: z.string().max(80).default(''),
  duration: z.number().min(1).max(20).default(4),
  transition: z.enum(['cut', 'fade', 'wipe']).default('fade'),
  palette: z.enum(paletteIds).nullable().default(null),
  items: z.array(z.string().max(100)).max(6).default([]),
  series: z
    .array(z.strictObject({ label: z.string().max(40), value: z.number().min(0).max(1e9) }))
    .max(6)
    .default([]),
  value: z.number().min(-1e9).max(1e9).default(0),
  suffix: z.string().max(20).default(''),
  imageId: idSchema.nullable().default(null),
  layers: z.array(layerSchema).max(40).default([]),
})
export const documentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(120),
    brief: z.string().max(4000).default(''),
    template: z.enum(templateIds),
    format: z.enum(formatIds).default('landscape'),
    fps: z.union([z.literal(30), z.literal(60)]).default(30),
    palette: z.enum(paletteIds).default('ink'),
    soundtrackId: idSchema.nullable().default(null),
    volume: z.number().min(0).max(1).default(0.6),
    scenes: z.array(sceneSchema).min(1).max(30),
  })
  .superRefine((document, ctx) => {
    if (document.scenes.reduce((sum, scene) => sum + scene.duration, 0) > 180)
      ctx.addIssue({
        code: 'custom',
        path: ['scenes'],
        message: 'Keep the film within 180 seconds.',
      })
    const ids = document.scenes.flatMap((scene) => [
      scene.id,
      ...scene.layers.map((layer) => layer.id),
    ])
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['scenes'],
        message: 'Scene and layer IDs must be unique.',
      })
    document.scenes.forEach((scene, index) => {
      if (
        scene.layers.some((layer) => layer.keyframes.some((frame) => frame.time > scene.duration))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', index],
          message: 'Keyframes exceed the scene duration.',
        })
    })
  })
export const projectSchema = z.strictObject({
  id: idSchema,
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  document: documentSchema,
})
export const assetSchema = z.strictObject({
  id: idSchema,
  name: z.string().max(200),
  kind: z.enum(['image', 'audio']),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/ogg']),
  bytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
})
export const librarySchema = z.strictObject({
  projects: z.array(projectSchema).max(100),
  assets: z.array(assetSchema).max(200),
})
export const createSchema = z.strictObject({
  template: z.enum(templateIds),
  title: z.string().trim().min(1).max(120),
  document: documentSchema.optional(),
})
export const updateSchema = z.strictObject({
  revision: z.number().int().positive(),
  document: documentSchema,
})
export type MotionDocument = z.infer<typeof documentSchema>
export type MotionScene = z.infer<typeof sceneSchema>
export type MotionLayer = z.infer<typeof layerSchema>
export type Keyframe = z.infer<typeof keyframeSchema>
export type MotionProject = z.infer<typeof projectSchema>
export type MotionAsset = z.infer<typeof assetSchema>
export type MotionLibrary = z.infer<typeof librarySchema>
export type TemplateId = (typeof templateIds)[number]
