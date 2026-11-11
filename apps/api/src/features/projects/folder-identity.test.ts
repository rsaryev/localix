import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rename, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { sql } from 'kysely'
import { tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProjectsService } from './service'

/**
 * A folder renamed while Localix was closed. Its identity (device, inode, birth time) was kept only
 * in the process that saw it, so after a restart nothing was suggested and the person had to find
 * the folder by hand. It is stored with the project now, each time the folder is seen.
 */
const temp = tempDirPerTest('folder-identity-')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const userId = 'u-identity'

async function open(file: string) {
  const db = createDatabase({ filename: file })
  await migrateToLatest(db)
  cleanups.push(() => destroyDatabase(db))
  return { db, projects: createProjectsService({ db }) }
}

const stored = async (db: Awaited<ReturnType<typeof open>>['db'], id: string) =>
  (
    await sql<{
      folder_identity: string | null
    }>`SELECT folder_identity FROM projects WHERE id = ${id}`.execute(db)
  ).rows[0]?.folder_identity ?? null

async function setup() {
  const base = realpathSync(temp())
  const from = join(base, 'work', 'claude-plugin-kit')
  const to = join(base, 'work', 'llx-plugin')
  await mkdir(from, { recursive: true })
  await mkdir(join(base, 'work', 'other'))
  const file = join(base, `${randomUUID()}.sqlite`)
  const first = await open(file)
  const project = await first.projects.createProject(userId, { name: 'kit', workingDir: from })
  return { base, from, to, file, first, project }
}

describe('a project remembers which folder it is', () => {
  test('the folder identity is written when the project lists with its folder present', async () => {
    const { first, project } = await setup()
    await first.db.updateTable('projects').set({ folder_identity: null }).execute()
    await first.projects.listProjects(userId)
    expect(await stored(first.db, project.id)).toMatch(/^\d+:\d+:\d+(\.\d+)?$/)
  })

  test('a folder renamed while the app was closed is suggested after the restart', async () => {
    const { from, to, file, first, project } = await setup()
    await first.projects.listProjects(userId)
    const identity = await stored(first.db, project.id)
    await destroyDatabase(first.db)
    await rename(from, to)

    // A second database at another path holds the same row: nothing this process saw of `from`
    // can answer, only what was stored.
    const second = await open(file)
    expect(await stored(second.db, project.id)).toBe(identity)
    expect(await second.projects.projectFolder(userId, project.id)).toEqual({
      path: from,
      state: 'missing',
      suggestion: to,
    })
  })

  test('a different folder made where the old one was is not suggested', async () => {
    const { base, from, first, project } = await setup()
    await first.projects.listProjects(userId)
    await rm(from, { recursive: true })
    await mkdir(join(base, 'work', 'claude-plugin-kit-2'))
    expect((await first.projects.projectFolder(userId, project.id)).suggestion).toBeNull()
  })

  test('relocating stores the new folder’s identity, so a second move is found too', async () => {
    const { base, from, to, first, project } = await setup()
    await first.projects.listProjects(userId)
    await rename(from, to)
    await first.projects.relocateProject(userId, project.id, to)
    const again = join(base, 'work', 'llx')
    await rename(to, again)
    expect((await first.projects.projectFolder(userId, project.id)).suggestion).toBe(again)
  })
})
