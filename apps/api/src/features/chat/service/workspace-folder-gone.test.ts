import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createProviderConnectionsService } from '../../provider-connections/service'
import { createProjectsRepository } from '../../projects/repository'
import { createFileWatchService } from '../../fs-watch/service'
import {
  createTestCatalogService,
  createTestChatService,
  testChatFeaturePorts,
} from '../test-harness'
import { testWork } from '../../../testing/work-fixture'

/**
 * A project whose folder was renamed, moved or deleted on disk: every consumer that works IN the
 * folder answers with the same 409 `workspace_folder_*` refusal, the session itself stays readable,
 * and the folder coming back works again without a restart.
 */
const temp = tempDirPerTest('folder-gone-')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function projectChat() {
  const root = temp()
  const folder = join(root, 'claude-plugin-kit')
  await mkdir(folder)
  await writeFile(join(folder, 'a.txt'), 'hello')
  const db = createDatabase({ filename: join(root, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  cleanups.push(() => destroyDatabase(db))
  const userId = 'u-folder-gone'
  const now = new Date().toISOString()
  await createProjectsRepository(db).insertProject({
    id: 'PRJ-13',
    userId,
    name: 'claude-plugin-kit',
    workingDir: folder,
    settings: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  const watched: string[] = []
  const ports = testChatFeaturePorts(db)
  const chat = createTestChatService({
    db,
    work: testWork(db),
    ports: {
      ...ports,
      createFileWatcher: (deps) =>
        createFileWatchService({
          ...deps,
          createWatcher: (watchRoot) => {
            watched.push(watchRoot)
            return { close() {} }
          },
        }),
    },
    catalogService: createTestCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db }),
  })
  const session = await chat.createSession(userId, { title: 'Files', projectId: 'PRJ-13' })
  return { chat, userId, sessionId: session.id, folder, root, watched }
}

const missing = (folder: string) => ({
  status: 409,
  code: 'workspace_folder_missing',
  detail: folder,
})

describe('a project folder that is gone', () => {
  test('opening Files answers 409 workspace_folder_missing, not a 404 of the session', async () => {
    const { chat, userId, sessionId, folder, root } = await projectChat()
    expect((await chat.listDirectory(userId, sessionId)).entries.map((e) => e.name)).toEqual([
      'a.txt',
    ])
    await rename(folder, join(root, 'llx-plugin'))

    expect(chat.listDirectory(userId, sessionId)).rejects.toMatchObject(missing(folder))
    // The session is still there: reading it is not what failed.
    expect((await chat.getSession(userId, sessionId)).id).toBe(sessionId)
  })

  test('every file operation and search refuses the same way', async () => {
    const { chat, userId, sessionId, folder, root } = await projectChat()
    await rename(folder, join(root, 'moved'))
    const refusals = await Promise.all(
      [
        chat.readFile(userId, sessionId, 'a.txt'),
        chat.writeFile(userId, sessionId, 'a.txt', 'x', 'hash'),
        chat.createFileEntry(userId, sessionId, '.', 'b.txt', 'file'),
        chat.findFiles(userId, sessionId, 'a'),
        chat.searchContent(userId, sessionId, 'hello'),
      ].map((call) =>
        call.then(
          () => null,
          (e: unknown) => e,
        ),
      ),
    )
    for (const refusal of refusals) expect(refusal).toMatchObject(missing(folder))
  })

  test('the workspace folder the terminal and language server open in is refused; the ownership check still answers', async () => {
    const { chat, userId, sessionId, folder, root } = await projectChat()
    await rename(folder, join(root, 'moved'))
    expect(chat.resolveSessionWorkspaceDir(userId, sessionId)).rejects.toMatchObject(
      missing(folder),
    )
    // Mini app scopes, resource refs and decisions use this only as "may this user use this chat".
    expect(await chat.resolveSessionCwd(userId, sessionId)).toBe(folder)
  })

  test('no watcher is armed on a missing folder, and one is once it is back', async () => {
    const { chat, userId, sessionId, folder, root, watched } = await projectChat()
    const moved = join(root, 'moved')
    await rename(folder, moved)
    expect(chat.listDirectory(userId, sessionId)).rejects.toMatchObject(missing(folder))
    expect(watched).toEqual([])

    await rename(moved, folder)
    const listing = await chat.listDirectory(userId, sessionId)
    expect(listing.entries.map((e) => e.name)).toEqual(['a.txt'])
    expect(listing.live).toBe(true)
    expect(watched).toEqual([folder])
  })

  test('a file where the folder was, and a symlink to a missing target, say so', async () => {
    const { chat, userId, sessionId, folder, root } = await projectChat()
    await rename(folder, join(root, 'moved'))
    await writeFile(folder, 'now a file')
    expect(chat.listDirectory(userId, sessionId)).rejects.toMatchObject({
      status: 409,
      code: 'workspace_folder_not_a_directory',
    })

    await rm(folder)
    await symlink(join(root, 'nowhere'), folder)
    expect(chat.listDirectory(userId, sessionId)).rejects.toMatchObject(missing(folder))
  })
})
