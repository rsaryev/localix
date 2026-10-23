import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { isPathWithin } from '@localixai/path-containment'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import { RESUME_DIR, resumePath } from '../shared/file-contract'
import { idSchema } from '../shared/schema'

export const fileRevision = (content: string) => createHash('sha256').update(content).digest('hex')
export async function resumeDirectory(workspace: string, create = false): Promise<string | null> {
  const root = await realpath(workspace)
  let dir = root
  for (const segment of RESUME_DIR.split('/')) {
    const next = join(dir, segment)
    if (create) await mkdir(next, { recursive: true, mode: 0o700 })
    try {
      dir = await realpath(next)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !create) return null
      throw error
    }
    if (!isPathWithin(root, dir)) throw new Error('Resume directory must stay inside the workspace')
  }
  return dir
}
export async function resumeFile(workspace: string, id: string, create = false): Promise<string> {
  idSchema.parse(id)
  const dir = await resumeDirectory(workspace, create)
  if (!dir) throw Object.assign(new Error('Resume not found'), { code: 'ENOENT' })
  const folder = join(dir, id)
  if (create) await mkdir(folder, { mode: 0o700 })
  const actual = await realpath(folder)
  if (!isPathWithin(dir, actual)) throw new Error('Resume folder must stay inside its workspace')
  const file = join(actual, 'resume.json')
  try {
    const target = await realpath(file)
    if (!isPathWithin(actual, target)) throw new Error('Resume file must stay inside its folder')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return file
}
export async function readResumeFile(file: string): Promise<string> {
  if ((await stat(file)).size > 500_000) throw new Error('Resume file exceeds 500 KB')
  const content = await readFile(file, 'utf8')
  if (Buffer.byteLength(content, 'utf8') > 500_000) throw new Error('Resume file exceeds 500 KB')
  return content
}
export async function writeResumeFile(file: string, content: string): Promise<void> {
  await atomicWriteFile(file, content, { mode: 0o600 })
}
export const relativeResumePath = resumePath
export const revisionDirectory = (file: string) => join(dirname(file), 'history')
