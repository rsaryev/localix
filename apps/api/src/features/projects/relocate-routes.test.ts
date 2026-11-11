import { describe, expect, test } from 'bun:test'
import { mkdir, rename } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Hono } from 'hono'
import { tempDirPerTest } from '@localixai/testing'

import type { AppContext } from '../../app'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { defaultErrorHandler } from '../../lib/http'
import { createProjectsRoutes } from './routes'
import { createProjectsService } from './service'

/** The folder status and the relocation over HTTP, with the refusals' status and code. */
const temp = tempDirPerTest('relocate-routes-')
const USER = 'user_relocate_route'

async function harness() {
  const base = realpathSync(temp())
  const db = createDatabase({ filename: join(base, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  const service = createProjectsService({ db, homeDir: join(base, 'home') })
  const app = new Hono<AppContext>()
  app.use('*', async (c, next) => {
    c.set('userId', USER)
    await next()
  })
  app.route('/rpc/projects', createProjectsRoutes(service))
  app.onError(defaultErrorHandler)
  const from = join(base, 'claude-plugin-kit')
  await mkdir(from)
  const project = await service.createProject(USER, { name: 'kit', workingDir: from })
  return { app, db, base, from, project }
}

const relocate = (app: Hono<AppContext>, id: string, path: string) =>
  app.request(`/rpc/projects/${id}/relocate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })

describe('project folder routes', () => {
  test('GET folder reports a missing folder with its suggestion; POST relocate moves it', async () => {
    const { app, db, base, from, project } = await harness()
    expect((await app.request(`/rpc/projects/${project.id}/folder`)).status).toBe(200)
    const to = join(base, 'llx-plugin')
    await rename(from, to)
    const folder = await app.request(`/rpc/projects/${project.id}/folder`)
    expect(await folder.json()).toEqual({ path: from, state: 'missing', suggestion: to })

    const moved = await relocate(app, project.id, to)
    expect(moved.status).toBe(200)
    expect(await moved.json()).toMatchObject({
      project: { id: project.id, workingDir: to },
      memory: 'none',
      trust: { before: false, after: false },
    })
    await destroyDatabase(db)
  })

  test('a folder that is not there is a 409 with its code, not a 404', async () => {
    const { app, db, base, project } = await harness()
    const response = await relocate(app, project.id, join(base, 'nowhere'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'workspace_folder_missing' } })
    await destroyDatabase(db)
  })
})
