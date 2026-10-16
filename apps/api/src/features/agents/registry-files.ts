import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentRecord } from './contracts'
import { listAgentFiles } from './discovery'

/**
 * The registry's file side: how a record lands on disk and how it leaves.
 *
 * File stems are not registry identity. Removal matches the parsed handle so a definition
 * written under a different file stem cannot reappear after deletion. Publication uses a
 * staged file and rename so readers never observe partially written JSON.
 */

/** Write (or overwrite) the LOSSLESS `.json` form of a record; returns the path written. */
export async function writeAgentRecordFile(dir: string, record: AgentRecord): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${record.handle}.json`)
  const staged = join(dir, `.${crypto.randomUUID()}.staged`)
  try {
    await writeFile(staged, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await rename(staged, path)
  } finally {
    await rm(staged, { force: true })
  }
  return path
}

/** Remove EVERY file in `dir` whose parsed record carries `name`; returns the paths removed. */
export async function removeAgentRecordFiles(dir: string, name: string): Promise<string[]> {
  const doomed = (await listAgentFiles(dir)).filter((file) => file.record.handle === name)
  await Promise.all(doomed.map((file) => rm(file.path, { force: true })))
  return doomed.map((file) => file.path)
}
