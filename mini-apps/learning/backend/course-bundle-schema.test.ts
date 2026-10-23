import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCourseBundle } from './course-bundle'

test('pending bundle defaults remain empty and invalid lesson fields keep precise diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'learning-bundle-schema-'))
  try {
    const root = await realpath(dir)
    const course = join(root, 'course.json')
    const lessonPath = join(root, 'lesson.json')
    const lesson = {
      id: ' lesson-one ',
      title: ' Lesson ',
      summary: ' Pending material ',
      estimatedMinutes: 1,
      generationStatus: 'pending' as const,
    }
    await writeFile(
      course,
      JSON.stringify({
        schemaVersion: 1,
        id: ' course-one ',
        title: ' Course ',
        topic: ' Topic ',
        goal: ' Goal ',
        description: ' Description ',
        level: 'beginner',
        language: ' en ',
        estimatedMinutes: 5,
        modules: ['module.json'],
      }),
    )
    await writeFile(
      join(root, 'module.json'),
      JSON.stringify({
        id: 'module-one',
        title: 'Module',
        description: 'Module description',
        lessons: ['lesson.json'],
      }),
    )
    await writeFile(lessonPath, JSON.stringify(lesson))
    const bundle = await loadCourseBundle(course, [root])
    expect(bundle.id).toBe('course-one')
    expect(bundle.outline.title).toBe('Course')
    expect(bundle.modules[0]?.lessons[0]).toEqual({
      ...lesson,
      id: 'lesson-one',
      title: 'Lesson',
      summary: 'Pending material',
      objectives: [],
      steps: [],
    })

    await writeFile(lessonPath, JSON.stringify({ ...lesson, estimatedMinutes: 0 }))
    await expect(loadCourseBundle(course, [root])).rejects.toMatchObject({
      diagnostic: { code: 'invalid-manifest', file: lessonPath, field: 'estimatedMinutes' },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
