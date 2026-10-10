import { z } from 'zod'

/**
 * The wire contract between the Motion Studio backend and its view.
 *
 * A project is a HyperFrames composition folder in the conversation workspace:
 *   .localix/motion/<id>/index.html          root composition (GSAP, data-* timing)
 *   .localix/motion/<id>/compositions/*.html scenes (sub-compositions)
 *   .localix/motion/<id>/blocks/             Localix motion kit (CSS + seek-safe GSAP helpers)
 *   .localix/motion/<id>/assets/             images, video, audio, fonts
 *   .localix/motion/<id>/snapshots/          PNG stills from `hyperframes snapshot`
 *   .localix/motion/<id>/renders/            MP4/WebM files from `hyperframes render`
 */
export const MOTION_DIR = '.localix/motion'
export const HYPERFRAMES_VERSION = '0.8.143'
export const PLAYER_VERSION = '0.8.143'

export const projectIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u, 'Use lower-case letters, digits and "-".')
export const formatSchema = z.enum(['landscape', 'portrait', 'square'])
export const fileEntrySchema = z.strictObject({
  name: z.string(),
  /** Workspace-relative path, e.g. .localix/motion/launch/renders/launch.mp4 */
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  updatedAt: z.string(),
})
export const jobSchema = z.strictObject({
  kind: z.enum(['render', 'snapshot', 'check']),
  state: z.enum(['running', 'done', 'failed']),
  /** 0..100 when the CLI reports it. */
  progress: z.number().min(0).max(100).nullable(),
  /** Last meaningful CLI line, or the failure. */
  message: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export const projectSchema = z.strictObject({
  id: projectIdSchema,
  title: z.string(),
  path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Root data-duration in seconds; null when the composition does not declare one. */
  duration: z.number().nonnegative().nullable(),
  scenes: z.number().int().nonnegative(),
  /** The style direction applied last (shared/styles.ts id), or null when unknown. */
  style: z.string().nullable(),
  updatedAt: z.string(),
  /** Changes whenever any source file changes: reload the player when it does. */
  revision: z.string(),
  /**
   * Signed base path of the project's files (`/rpc/motion/view/<session>/<id>/<signature>/`),
   * valid while this backend runs. Join a project-relative file with motionFileUrl().
   */
  view: z.string(),
  renders: z.array(fileEntrySchema),
  snapshots: z.array(fileEntrySchema),
  /** Static problems found without a browser (missing root attributes, unregistered timeline…). */
  issues: z.array(z.string()),
  job: jobSchema.nullable(),
})
export const toolingSchema = z.strictObject({
  /** Node ≥ 22 on the login PATH: required for snapshot and render. */
  node: z.string().nullable(),
  ffmpeg: z.boolean(),
})
export const librarySchema = z.strictObject({
  projects: z.array(projectSchema),
  tooling: toolingSchema,
  /** The film a create request just made, for the view to open. */
  focus: z.string().optional(),
})
export const createSchema = z.strictObject({
  direction: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
})
export const renderSchema = z.strictObject({
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
  format: z.enum(['mp4', 'webm']).default('mp4'),
})
export const snapshotSchema = z.strictObject({
  /** Seconds; omitted = evenly spaced frames across the film. */
  at: z.array(z.number().nonnegative()).max(24).optional(),
})

export type MotionProject = z.infer<typeof projectSchema>
export type MotionLibrary = z.infer<typeof librarySchema>
export type MotionJob = z.infer<typeof jobSchema>
export type MotionFile = z.infer<typeof fileEntrySchema>
export type MotionFormat = z.infer<typeof formatSchema>

/**
 * Routes (all under /rpc/motion, `?sessionId=` like the other plugin routes unless noted):
 *   GET    /library                         → MotionLibrary
 *   GET    /styles/:id/preview.jpg          → a still of the direction's film (gallery)
 *   GET    /directions/:id/<file>           → the direction's sample film, for the player
 *   POST   /projects            createSchema → MotionLibrary (focus = the new film)
 *   DELETE /projects/:id                    → MotionLibrary
 *   POST   /projects/:id/render renderSchema → MotionLibrary (job starts; poll/feeds update it)
 *   POST   /projects/:id/snapshot snapshotSchema → MotionLibrary
 *   POST   /projects/:id/cancel             → MotionLibrary (stops the running job)
 *   GET    <project.view><file path>       → the project's files, for <hyperframes-player src>,
 *          <img> and <video>; build it with motionFileUrl(). No query string: relative URLs
 *          inside the composition resolve to sibling files under the same signed base.
 */
export const motionFileUrl = (project: Pick<MotionProject, 'view'>, file = 'index.html') =>
  `${project.view}${file.split('/').map(encodeURIComponent).join('/')}`
export const MOTION_ROOT = 'localix://resource/motion'
export const motionUri = (id: string) => `${MOTION_ROOT}/${id}`
export function parseMotionUri(uri: string) {
  if (!uri.startsWith(`${MOTION_ROOT}/`)) return null
  const parsed = projectIdSchema.safeParse(uri.slice(MOTION_ROOT.length + 1))
  return parsed.success ? parsed.data : null
}
