import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isPathWithin } from '@localixai/path-containment'
import { revisionRecordSchema, type RevisionRecord } from '../shared/file-contract'
import { readResumeFile, revisionDirectory, writeResumeFile } from './files'

async function historyDir(file: string, create: boolean): Promise<string | null> {
  const dir = revisionDirectory(file)
  if (create) await mkdir(dir, { recursive: true, mode: 0o700 })
  let actual
  try {
    actual = await realpath(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !create) return null
    throw error
  }
  if (actual !== dir) throw new Error('Resume history cannot be a symbolic link')
  return actual
}
export async function readRevisions(file: string): Promise<RevisionRecord[]> {
  const dir = await historyDir(file, false)
  if (!dir) return []
  const names = (await readdir(dir)).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
  const records: RevisionRecord[] = []
  for (const name of names) {
    const target = await realpath(join(dir, name))
    if (!isPathWithin(dir, target)) throw new Error('History snapshot must stay inside its folder')
    const record = revisionRecordSchema.parse(JSON.parse(await readResumeFile(target)))
    if (`${record.revision}.json` !== name) throw new Error('Invalid history snapshot identity')
    records.push(record)
  }
  return records.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
}
export async function saveRevision(file: string, record: RevisionRecord) {
  const dir = (await historyDir(file, true))!
  const target = join(dir, `${record.revision}.json`)
  if (
    await stat(target).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      },
    )
  )
    return
  await writeResumeFile(target, `${JSON.stringify(revisionRecordSchema.parse(record), null, 2)}\n`)
  const records = await readRevisions(file)
  for (const old of records.slice(60)) await rm(join(dir, `${old.revision}.json`))
}
