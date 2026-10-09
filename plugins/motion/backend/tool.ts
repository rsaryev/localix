import { classifyByAction, type PluginContext } from '@localixai/plugin-sdk/backend'
import { z } from 'zod'
import { resolve } from 'node:path'
import { MOTION_DIR, MOTION_LIBRARY } from '../shared/file-contract'
import { documentSchema, idSchema, createSchema, updateSchema } from '../shared/schema'
import { motionPresets, presetKeyframes } from '../shared/motion-presets'
import { keyframeSchema, layouts } from '../shared/schema'
import { createTemplateDocument, templates } from '../shared/templates'
import { motionUri } from '../shared/resource-uri'
import { MotionError, type MotionService } from './service'

export const toolInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('guide') }),
  z.strictObject({ action: z.literal('list') }),
  z.strictObject({ action: z.literal('get'), id: idSchema }),
  createSchema.extend({ action: z.literal('create') }),
  updateSchema.extend({ action: z.literal('update'), id: idSchema }),
  z.strictObject({
    action: z.literal('duplicate'),
    id: idSchema,
    title: z.string().trim().min(1).max(120),
  }),
])
export function createMotionTool(ctx: PluginContext, service: MotionService) {
  return ctx.defineTool({
    name: 'motion_studio',
    label: 'Motion Studio',
    activeVerb: 'Creating motion',
    description:
      'Author motion videos shared with the Motion Studio editor. Call guide for templates, document schema and keyframe conventions. create accepts a complete document or a template. get returns the current revision; update replaces the document with compare-and-swap, preserving concurrent user edits. duplicate makes a variant. list includes projects and uploaded media IDs. Video export is local in the workbench; never claim an MP4 exists from authoring alone.',
    inputSchema: toolInputSchema,
    executionMode: 'sequential',
    mutates: true,
    permissionPaths: (input) => {
      const parsed = toolInputSchema.safeParse(input)
      return parsed.success && ['create', 'update', 'duplicate'].includes(parsed.data.action)
        ? [resolve(ctx.cwd, MOTION_DIR)]
        : []
    },
    classify: classifyByAction({
      guide: { effect: 'read' },
      list: { effect: 'read' },
      get: { effect: 'read' },
      create: { effect: 'files' },
      update: { effect: 'files' },
      duplicate: { effect: 'files' },
    }),
    async execute(_callId, input) {
      try {
        if (input.action === 'guide')
          return {
            content: JSON.stringify({
              templates,
              canonicalFile: MOTION_LIBRARY,
              primitives: {
                layouts,
                motionPresets: Object.fromEntries(
                  motionPresets.map((preset) => [
                    preset,
                    presetKeyframes(preset, 4, keyframeSchema.parse({ time: 0, x: 0.5, y: 0.5 })),
                  ]),
                ),
              },
              schema: z.toJSONSchema(documentSchema, { io: 'input' }),
              example: createTemplateDocument('launch'),
              conventions: [
                'Write a brief, then a hook, reveal, evidence and end card. Use 2–6 seconds per beat; make claims only from supplied evidence.',
                'Use layouts from primitives.layouts: poster, ribbon, orbit, editorial, steps and bars add distinct composition grammars. hook provides masked large type on a measured grid, focus reveals an aperture or an editable items flow, and wordmark resolves into a lockup. custom displays only keyframed layers. Grid and frame layers provide reusable measured stages and aperture corners.',
                'Layer x/y and width/height use fractions of the frame; positions are the layer center. fontSize is a fraction of the shorter frame edge. rotation is degrees. Times are scene-local seconds; each keyframe supplies a complete transform.',
                'Use UUIDs for scene/layer IDs; keyframes strictly increase and stay inside their scene. Maximum 180 seconds, 30 scenes, 40 layers per scene.',
                'Use only asset IDs from list: scene imageId and image-layer assetId need images; soundtrackId needs audio. The user uploads assets in the editor. Library and assets are in the current workspace .localix/motion, shared by conversations in that workspace.',
                'Keep text short enough to read. Use items for concrete steps, value/suffix for a headline figure, and series for actual labeled bar values. A scene palette override changes register; null inherits the video palette. Templates contain illustrative copy, which must be replaced for real projects.',
                'Preview and MP4/WebM export use the same deterministic renderer. Open the resource in Motion Studio to review and export. The tool authors a project, not an encoded video.',
              ],
            }),
          }
        if (input.action === 'list') return { content: JSON.stringify(await service.list()) }
        if (input.action === 'get') return { content: JSON.stringify(await service.get(input.id)) }
        if (input.action === 'duplicate') {
          const source = await service.get(input.id)
          const state = await service.create(source.document.template, input.title, {
            ...source.document,
            title: input.title,
          })
          const project = state.projects[state.projects.length - 1]!
          return { content: JSON.stringify({ ...project, uri: motionUri(project.id) }) }
        }
        const state =
          input.action === 'create'
            ? await service.create(input.template, input.title, input.document)
            : await service.update(input.id, input.revision, input.document)
        const project =
          input.action === 'create'
            ? state.projects[state.projects.length - 1]!
            : state.projects.find((project) => project.id === input.id)!
        return { content: JSON.stringify({ ...project, uri: motionUri(project.id) }) }
      } catch (error) {
        return {
          content:
            error instanceof MotionError
              ? `${error.code}: ${error.message}`
              : 'Motion project could not be saved. Check the guide and try again.',
          isError: true,
        }
      }
    },
  })
}
