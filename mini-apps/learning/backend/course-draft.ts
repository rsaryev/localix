import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import { isPathWithin } from '@localixai/path-containment'
import { loadCourseBundle } from './course-bundle'

const id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120)
const text = z.string().trim().min(1).max(2_000)
const lesson = z.object({
  id,
  title: text.max(240),
  summary: text,
  estimatedMinutes: z.number().int().min(1).max(480),
})
const outline = z.object({
  id,
  title: text.max(240),
  topic: text.max(240),
  goal: text,
  description: text,
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  language: text.max(40),
  estimatedMinutes: z.number().int().min(5).max(100_000),
  modules: z
    .array(
      z.object({
        id,
        title: text.max(240),
        description: text,
        lessons: z.array(lesson).min(1).max(32),
      }),
    )
    .min(1)
    .max(32),
})

/** A compact plan becomes a valid skeleton in one call; it never overwrites an existing draft. */
export async function createCourseDraft(workspace: string, outlinePath: string): Promise<string> {
  const root = await realpath(workspace)
  const source = await realpath(resolve(workspace, outlinePath))
  if (!isPathWithin(root, source)) throw new Error('The outline must be inside this workspace')
  if ((await stat(source)).size > 256_000) throw new Error('The outline is too large')
  const plan = outline.parse(JSON.parse(await readFile(source, 'utf8')))
  const parent = join(root, '.localix')
  await mkdir(parent, { recursive: true })
  if (!isPathWithin(root, await realpath(parent)))
    throw new Error('The draft directory must stay inside this workspace')
  const drafts = join(parent, 'learning-drafts')
  await mkdir(drafts, { recursive: true })
  if (!isPathWithin(root, await realpath(drafts)))
    throw new Error('The draft directory must stay inside this workspace')
  const staging = await mkdtemp(join(drafts, '.draft-'))
  const write = async (file: string, value: unknown) => {
    await mkdir(dirname(file), { recursive: true })
    await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`)
  }
  try {
    const { modules, ...course } = plan
    await write(join(staging, 'course.json'), {
      schemaVersion: 1,
      ...course,
      modules: modules.map((module) => `modules/${module.id}/module.json`),
    })
    for (const module of modules) {
      const base = join(staging, 'modules', module.id)
      await write(join(base, 'module.json'), {
        id: module.id,
        title: module.title,
        description: module.description,
        lessons: module.lessons.map((item) => `lessons/${item.id}/lesson.json`),
      })
      for (const item of module.lessons)
        await write(join(base, 'lessons', item.id, 'lesson.json'), {
          ...item,
          generationStatus: 'pending',
          objectives: [],
          steps: [],
        })
    }
    await loadCourseBundle(join(staging, 'course.json'), [root])
    const target = join(drafts, plan.id)
    // Even an empty existing draft belongs to the user; rename may otherwise replace it.
    if (
      await stat(target).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        },
      )
    )
      throw new Error('This draft already exists. Patch its files instead of recreating it.')
    await rename(staging, target)
    return join(target, 'course.json')
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
