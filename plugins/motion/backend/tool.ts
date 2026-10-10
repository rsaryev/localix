import { classifyByAction, type PluginContext } from '@localixai/plugin-sdk/backend'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {
  MOTION_DIR,
  formatSchema,
  motionUri,
  projectIdSchema,
  renderSchema,
} from '../shared/contract'
import { projectDirectory } from './files'
import { detectTooling, runToEnd } from './jobs'
import {
  MotionError,
  applyStyle,
  createProject,
  importAssets,
  listProjects,
  readProject,
} from './projects'
import { motionStyles, DEFAULT_STYLE } from '../shared/styles'
import { renderArgs, startSnapshot } from './routes'

const id = projectIdSchema
export const toolInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('guide') }),
  z.strictObject({ action: z.literal('list') }),
  z.strictObject({
    action: z.literal('create'),
    title: z.string().trim().min(1).max(120),
    direction: z.string().default(DEFAULT_STYLE),
    format: formatSchema.optional(),
    name: id.optional(),
  }),
  z.strictObject({ action: z.literal('restyle'), id, direction: z.string() }),
  z.strictObject({
    action: z.literal('import'),
    id,
    files: z
      .array(
        z.strictObject({
          path: z.string().min(1).max(1024),
          name: z.string().min(1).max(100).optional(),
        }),
      )
      .min(1)
      .max(30),
  }),
  z.strictObject({ action: z.literal('check'), id, deep: z.boolean().default(false) }),
  z.strictObject({
    action: z.literal('snapshot'),
    id,
    at: z.array(z.number().nonnegative()).max(24).optional(),
  }),
  renderSchema.extend({ action: z.literal('render'), id }),
])

const GUIDE = {
  model:
    'A film is a HyperFrames project (HTML + GSAP, seeked frame by frame) in .localix/motion/<id>/. You author it as code with the ordinary read/edit/write tools; motion_studio scaffolds, imports media, checks, snapshots and renders.',
  files: {
    'index.html':
      'root composition: scene slots (sub-compositions) on the timeline + transitions between them',
    'compositions/*.html':
      'one scene per file, wrapped in <template>, registering window.__timelines["<id>"]',
    'blocks/motion-kit.js':
      'MK.* seek-safe helpers: revealLines/Words/Chars, typewriter, counter, wordCarousel, cursorPath, click, annotate, drawPath, bars, pushIn, grain, transition, withLayout, offsetWithin, random',
    'blocks/motion-kit.css':
      'tokens (--u = 1% of the short edge, --mk-* colours, type scale) and components: mk-browser, mk-cursor, mk-card, mk-pill, mk-caption, mk-lower-third, mk-stat, mk-bars, mk-gridlines, mk-dots, mk-glow, mk-starburst, mk-light-leak, mk-grain, mk-vignette',
    'AGENTS.md': 'the project contract, block reference and craft rules — read it first',
    'BRIEF.md / STORYBOARD.md': 'fill before building: audience, message, beats with timings',
    'assets/': 'images, video, audio, fonts brought in with import',
  },
  workflow: [
    '1. Brief: read the real sources (landing copy, README, brand files) and write BRIEF.md and STORYBOARD.md (beats with start/duration). Never invent claims, numbers or quotes.',
    '2. create from the direction that fits the brief (guide lists them; the user may have picked one). Read AGENTS.md, DIRECTION.md and the scenes. Keep the direction’s choreography where it serves the story, replace every line, add or drop scenes. For a structure of your own in a direction’s look, create from the closest direction and rebuild, or restyle.',
    '3. import the real logo, screenshots and audio, then reference them as assets/<file>.',
    '4. Edit scenes one at a time with small edits. Retime in index.html (scene data-start/data-duration and the transition times) and keep the root data-duration equal to the last scene end.',
    '5. check after each round (static contract; deep: true adds the browser check for layout, contrast and runtime errors). Fix every finding.',
    '6. snapshot at each beat midpoint and LOOK at the PNGs (contact-sheet.jpg shows all): text fit, safe margins, hierarchy, nothing stuck or missing. Fix and re-snapshot.',
    '7. render only when the user asks. The user previews and renders in Motion Studio too.',
  ],
  rules: [
    'Determinism: one paused gsap timeline per composition, registered after its tweens; no Math.random (MK.random), clocks, timers, CSS animation/transition or .play().',
    'Layout is display:none until a clip starts: measure only inside MK.withLayout / with MK.offsetWithin at build time.',
    'Never tween visibility/display/autoAlpha on a .clip; never pair a CSS transform with a GSAP tween on the same element (use fromTo).',
    'Craft: one idea per scene; 2–4 s beats, hero 3–5 s, end card holds ≥ 2.5 s still; text holds ≥ 0.5 s + 0.3 s/word after landing; hero type 10–12 --u, body ≥ 3.6 --u; keep text inside the 5% safe margin.',
    'Motion: expo.out for arrivals, power3.in exits at ~65% of the entrance, power2.inOut for moves, linear only for drift; stagger words 80–120 ms, chars 30–50 ms, lines 200–300 ms; one overshoot per scene at most; one or two transition kinds per film.',
    'Finish: subtle grain (≤ 8%), soft vignette, glow only on the hero; a slow 2–5% push-in keeps the camera alive.',
  ],
}

export function createMotionTool(ctx: PluginContext) {
  const workspace = ctx.cwd
  const folderOf = async (projectId: string) => {
    const folder = await projectDirectory(workspace, projectId)
    if (!folder)
      throw new MotionError('not_found', `No film "${projectId}" in ${MOTION_DIR}. Call list.`)
    return folder
  }
  const needTooling = async () => {
    const tooling = await detectTooling()
    if (!tooling.node || !tooling.ffmpeg)
      throw new MotionError(
        'unavailable',
        `HyperFrames needs Node 22+ (found: ${tooling.node ?? 'none'}) and FFmpeg (${tooling.ffmpeg ? 'found' : 'missing'}) on PATH.`,
      )
  }
  return ctx.defineTool({
    name: 'motion_studio',
    label: 'Motion Studio',
    activeVerb: 'Making motion',
    description:
      'Motion films as HyperFrames code (HTML/CSS/GSAP) in .localix/motion/<id>/. create forks a direction — a complete, playing film with its own idea, layout and motion (blackout, relay, nightfall, orbit, type-play, daylight, connect, momentum, soft-signal, offbeat, field-notes; guide describes each); restyle applies another direction’s tokens and rules to an existing film; edit its files with the normal file tools; import copies workspace screenshots, logos, video and audio into its assets/; check validates the composition; snapshot renders PNG stills to review visually; render writes an MP4/WebM. guide returns the workflow, files and craft rules. Render only when the user asks.',
    inputSchema: toolInputSchema,
    executionMode: 'sequential',
    mutates: true,
    permissionPaths: (input) => {
      const parsed = toolInputSchema.safeParse(input)
      return parsed.success && parsed.data.action !== 'guide' && parsed.data.action !== 'list'
        ? [resolve(workspace, MOTION_DIR)]
        : []
    },
    classify: classifyByAction({
      guide: { effect: 'read' },
      list: { effect: 'read' },
      check: { effect: 'read' },
      create: { effect: 'files' },
      restyle: { effect: 'files' },
      import: { effect: 'files' },
      snapshot: { effect: 'files' },
      render: { effect: 'files' },
    }),
    async execute(_callId, input) {
      try {
        if (input.action === 'guide')
          return {
            content: JSON.stringify({
              ...GUIDE,
              directions: motionStyles.map(
                ({ id, name, category, description, format, direction }) => ({
                  id,
                  name,
                  category,
                  description,
                  format,
                  rules: direction,
                }),
              ),
            }),
          }
        if (input.action === 'restyle') {
          const direction = await applyStyle(await folderOf(input.id), input.direction)
          return {
            content: JSON.stringify({
              direction: direction.id,
              files: ['DIRECTION.md', 'blocks/style.css'],
              next: 'Read DIRECTION.md and rework scenes that fight the new direction (layout, type case, motion, transitions).',
            }),
          }
        }
        if (input.action === 'list') {
          const projects = await listProjects(workspace)
          return {
            content: JSON.stringify({
              projects: projects.map((p) => ({
                id: p.id,
                title: p.title,
                path: p.path,
                uri: motionUri(p.id),
                size: `${p.width}x${p.height}`,
                duration: p.duration,
                scenes: p.scenes,
                issues: p.issues.length,
                renders: p.renders.map((r) => r.path),
              })),
              tooling: await detectTooling(),
            }),
          }
        }
        if (input.action === 'create') {
          const projectId = await createProject(workspace, input)
          const project = await readProject(await folderOf(projectId), projectId)
          return {
            content: JSON.stringify({
              id: projectId,
              path: project.path,
              uri: motionUri(projectId),
              files: [
                'AGENTS.md',
                'BRIEF.md',
                'STORYBOARD.md',
                'index.html',
                ...(await readdir(join(await folderOf(projectId), 'compositions'))).map(
                  (f) => `compositions/${f}`,
                ),
                'blocks/motion-kit.js',
                'blocks/motion-kit.css',
              ],
              next: `Read ${project.path}/AGENTS.md, fill BRIEF.md and STORYBOARD.md, import real media, then rewrite the scenes. The sample copy is flagged by check until replaced.`,
            }),
          }
        }
        if (input.action === 'import') {
          const imported = await importAssets(workspace, input.id, input.files)
          return {
            content: JSON.stringify({ imported }),
            isError: imported.every((item) => item.error),
          }
        }
        const folder = await folderOf(input.id)
        if (input.action === 'check') {
          const project = await readProject(folder, input.id)
          const tooling = await detectTooling()
          const cli = tooling.node
            ? await runToEnd(folder, 'check', input.deep ? ['check'] : ['lint'])
            : null
          return {
            content: JSON.stringify({
              ok: project.issues.length === 0 && (cli?.code ?? 0) === 0,
              issues: project.issues,
              hyperframes: cli
                ? cli.output.split('\n').slice(-40).join('\n')
                : 'Node 22+ is not on PATH; only the static check ran.',
              duration: project.duration,
              scenes: project.scenes,
            }),
          }
        }
        await needTooling()
        if (input.action === 'snapshot') {
          const { done } = await startSnapshot(folder, input.at)
          const result = await done
          const project = await readProject(folder, input.id)
          return {
            content: JSON.stringify({
              ok: result.code === 0,
              stills: project.snapshots.map((s) => s.path).sort(),
              review:
                'Open the PNGs (contact-sheet.jpg shows every frame) and check text fit, margins, hierarchy and that each beat reads.',
              log: result.code === 0 ? undefined : result.output.split('\n').slice(-25).join('\n'),
            }),
            isError: result.code !== 0,
          }
        }
        const result = await runToEnd(folder, 'render', renderArgs(input, input.id))
        const project = await readProject(folder, input.id)
        return {
          content: JSON.stringify({
            ok: result.code === 0,
            file: result.code === 0 ? project.renders[0]?.path : undefined,
            log: result.output.split('\n').slice(-20).join('\n'),
          }),
          isError: result.code !== 0,
        }
      } catch (error) {
        return {
          content:
            error instanceof MotionError
              ? `${error.code}: ${error.message}`
              : `Motion Studio could not ${input.action}: ${error instanceof Error ? error.message : 'unknown error'}`,
          isError: true,
        }
      }
    },
  })
}
