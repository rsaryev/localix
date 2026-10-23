import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { encodeResourceSegment } from '@localixai/mini-app-sdk/backend'

import { loadCourseBundle, type LoadedCourseBundle } from './course-bundle'

export async function importCourseBundle(
  source: LoadedCourseBundle,
  dataDir: string,
): Promise<{ bundle: LoadedCourseBundle; manifestPath: string }> {
  const coursesDir = join(dataDir, 'courses')
  const targetDir = join(coursesDir, encodeResourceSegment(source.id))
  const suffix = `${process.pid.toString(36)}-${Date.now().toString(36)}`
  const stagingDir = `${targetDir}.incoming-${suffix}`
  const previousDir = `${targetDir}.previous-${suffix}`
  await mkdir(coursesDir, { recursive: true })
  let staged: LoadedCourseBundle
  try {
    // Only the files the bundle loader resolved — never the directory that holds `course.json`.
    // Copying that directory recursively imported whatever sat beside the manifest: a
    // `course.json` at the workspace root pulled `.git`, `node_modules` and `.env` into session
    // data. `filePaths` are canonical and proven inside `rootDir` by the loader.
    await mkdir(stagingDir, { recursive: true })
    for (const file of source.filePaths) {
      const target = join(stagingDir, relative(source.rootDir, file))
      await mkdir(dirname(target), { recursive: true })
      await copyFile(file, target)
    }
    staged = await loadCourseBundle(join(stagingDir, 'course.json'), [stagingDir])
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
  let movedPrevious = false
  try {
    await rename(targetDir, previousDir)
    movedPrevious = true
  } catch (error) {
    // Any failure but "no previous install" leaves the staged copy behind unless it goes here.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await rm(stagingDir, { recursive: true, force: true })
      throw error
    }
  }
  try {
    await rename(stagingDir, targetDir)
  } catch (error) {
    if (movedPrevious) await rename(previousDir, targetDir).catch(() => {})
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
  if (movedPrevious) await rm(previousDir, { recursive: true, force: true })
  const manifestPath = join(targetDir, 'course.json')
  return {
    bundle: {
      ...staged,
      rootDir: targetDir,
      manifestPath,
      filePaths: staged.filePaths.map((file) => join(targetDir, relative(stagingDir, file))),
    },
    manifestPath,
  }
}
