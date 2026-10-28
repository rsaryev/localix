import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, describe, expect, test } from 'bun:test'

import type { AppContext } from '../../app'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { defaultErrorHandler } from '../../lib/http'
import { inspectPath } from './inspect-path'
import { createProjectsRoutes } from './routes'
import { createProjectsService } from './service'

const tempDir = join(tmpdir(), `localix-inspect-path-tests-${process.pid}`)
const USER = 'user_inspect_route'

afterAll(() => rm(tempDir, { recursive: true, force: true }))

async function fixture() {
  const dir = join(tempDir, `ws-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'paper.pdf')
  await writeFile(file, '%PDF-1.4\n')
  return { dir, file }
}

async function harness() {
  await mkdir(tempDir, { recursive: true })
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  const service = createProjectsService({ db })
  const app = new Hono<AppContext>()
  app.use('*', async (c, next) => {
    c.set('userId', USER)
    await next()
  })
  app.route('/rpc/projects', createProjectsRoutes(service))
  app.onError(defaultErrorHandler)
  const projectIds = async () => (await service.listProjects(USER)).projects.map((p) => p.id)
  return { app, db, projectIds }
}

const post = (app: Hono<AppContext>, body: unknown) =>
  app.request('/rpc/projects/inspect-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code

describe('inspectPath', () => {
  test('classifies a file and a directory, normalizing a trailing separator', async () => {
    const { dir, file } = await fixture()
    expect(await inspectPath(file)).toEqual({ kind: 'file', path: file })
    expect(await inspectPath(`${dir}/`)).toEqual({ kind: 'directory', path: dir, broad: false })
  })

  test('marks a filesystem root and the home folder as too broad to open', async () => {
    const { dir } = await fixture()
    expect((await inspectPath('/')).broad).toBe(true)
    expect((await inspectPath(dir, `${dir}/`)).broad).toBe(true)
  })

  test('refuses a relative path and reports a missing one as not found', async () => {
    for (const bad of ['../../etc', 'relative/file.pdf', '']) {
      const error = await inspectPath(bad).catch((caught: unknown) => caught)
      expect((error as { code?: string }).code).toBe('project_path_not_absolute')
    }
    const missing = await inspectPath(join(tempDir, `missing-${randomUUID()}.pdf`)).catch(
      (caught: unknown) => caught,
    )
    expect((missing as { code?: string }).code).toBe('project_path_not_found')
  })
})

describe('POST /rpc/projects/inspect-path', () => {
  test('classifies over HTTP and creates no project', async () => {
    const { app, db, projectIds } = await harness()
    const { dir, file } = await fixture()
    const before = await projectIds()

    const fileRes = await post(app, { path: file })
    expect(fileRes.status).toBe(200)
    expect(await fileRes.json()).toEqual({ kind: 'file', path: file })
    const dirRes = await post(app, { path: dir })
    expect(dirRes.status).toBe(200)
    expect(await dirRes.json()).toEqual({ kind: 'directory', path: dir, broad: false })

    expect(await projectIds()).toEqual(before)
    await destroyDatabase(db)
  })

  test('answers 400 for a relative or empty path and 404 for a missing one', async () => {
    const { app, db, projectIds } = await harness()
    const before = await projectIds()

    const relative = await post(app, { path: 'relative/paper.pdf' })
    expect(relative.status).toBe(400)
    expect(await errorCode(relative)).toBe('project_path_not_absolute')
    const missing = await post(app, { path: join(tempDir, `nope-${randomUUID()}.pdf`) })
    expect(missing.status).toBe(404)
    expect(await errorCode(missing)).toBe('project_path_not_found')
    expect((await post(app, { path: '' })).status).toBe(400)

    expect(await projectIds()).toEqual(before)
    await destroyDatabase(db)
  })
})
