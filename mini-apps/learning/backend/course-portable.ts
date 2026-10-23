import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { loadCourseBundle, type LoadedCourseBundle } from './course-bundle'

export const PORTABLE_COURSE_MIME = 'application/vnd.localix.learning-course+json'
export const PORTABLE_COURSE_EXTENSION = '.localix-course'
export const MAX_PORTABLE_COURSE_BYTES = 12 * 1024 * 1024

const MAX_PORTABLE_FILES = 512
const MAX_PORTABLE_FILE_BYTES = 512 * 1024

const portablePath = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    'File paths must be normalized relative paths inside the course bundle.',
  )

const portableCourse = z.object({
  format: z.literal('localix-learning-course'),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  course: z.object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(240),
  }),
  files: z
    .array(
      z.object({
        path: portablePath,
        content: z.string(),
      }),
    )
    .min(1)
    .max(MAX_PORTABLE_FILES),
})

export interface PortableCourseImport {
  bundle: LoadedCourseBundle
  cleanup: () => Promise<void>
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export async function serializeCourseBundle(bundle: LoadedCourseBundle): Promise<string> {
  const files = await Promise.all(
    bundle.filePaths.map(async (file) => {
      const relative = path.relative(bundle.rootDir, file).split(path.sep).join('/')
      const content = await readFile(file, 'utf8')
      if (byteLength(content) > MAX_PORTABLE_FILE_BYTES) {
        throw new Error(
          `Course file exceeds the ${MAX_PORTABLE_FILE_BYTES}-byte export limit: ${relative}`,
        )
      }
      return { path: relative, content }
    }),
  )
  files.sort((a, b) => {
    if (a.path === 'course.json') return -1
    if (b.path === 'course.json') return 1
    return a.path.localeCompare(b.path)
  })
  const serialized = `${JSON.stringify(
    {
      format: 'localix-learning-course',
      version: 1,
      exportedAt: new Date().toISOString(),
      course: { id: bundle.id, title: bundle.outline.title },
      files,
    },
    null,
    2,
  )}\n`
  if (byteLength(serialized) > MAX_PORTABLE_COURSE_BYTES) {
    throw new Error(
      `Course export exceeds the ${MAX_PORTABLE_COURSE_BYTES}-byte portable bundle limit.`,
    )
  }
  return serialized
}

export async function materializePortableCourse(raw: string): Promise<PortableCourseImport> {
  if (byteLength(raw) > MAX_PORTABLE_COURSE_BYTES) {
    throw new Error(`Course file exceeds the ${MAX_PORTABLE_COURSE_BYTES}-byte import limit.`)
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new Error('The selected file is not a valid Localix course.', { cause })
  }
  const parsed = portableCourse.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `Invalid Localix course at ${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'unknown issue'}`,
    )
  }

  const seen = new Set<string>()
  let contentBytes = 0
  for (const file of parsed.data.files) {
    if (seen.has(file.path)) throw new Error(`Duplicate course file: ${file.path}`)
    seen.add(file.path)
    const size = byteLength(file.content)
    if (size > MAX_PORTABLE_FILE_BYTES) {
      throw new Error(`Course file exceeds the ${MAX_PORTABLE_FILE_BYTES}-byte limit: ${file.path}`)
    }
    contentBytes += size
    if (contentBytes > MAX_PORTABLE_COURSE_BYTES) {
      throw new Error('The expanded course exceeds the portable bundle limit.')
    }
  }
  if (!seen.has('course.json')) throw new Error('The portable course is missing course.json.')

  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'localix-course-import-'))
  const cleanup = () => rm(rootDir, { recursive: true, force: true })
  try {
    for (const file of parsed.data.files) {
      const target = path.join(rootDir, ...file.path.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.content, 'utf8')
    }
    const bundle = await loadCourseBundle(path.join(rootDir, 'course.json'), [rootDir])
    if (bundle.id !== parsed.data.course.id || bundle.outline.title !== parsed.data.course.title) {
      throw new Error('Portable course metadata does not match its root course.json.')
    }
    return { bundle, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
