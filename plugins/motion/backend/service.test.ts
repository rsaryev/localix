import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMotionService } from './service'
import { createMotionRoutes } from './routes'
import { createMotionResourceProvider } from './context'
import { createTemplateDocument } from '../shared/templates'
import { librarySchema } from '../shared/schema'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'localix-motion-'))
  dirs.push(dir)
  return dir
}

test('projects survive new callers and concurrent creates do not lose writes', async () => {
  const dir = await folder()
  await Promise.all(
    ['One', 'Two', 'Three'].map((title) => createMotionService(dir).create('launch', title)),
  )
  const state = await createMotionService(dir).list()
  expect(state.projects.map((project) => project.document.title).sort()).toEqual([
    'One',
    'Three',
    'Two',
  ])
  const persisted = JSON.parse(await readFile(join(dir, '.localix/motion/library.json'), 'utf8'))
  expect(librarySchema.parse(persisted)).toEqual(state)
  expect((await createMotionService(await folder()).list()).projects).toEqual([])
})
test('a concurrent agent edit cannot overwrite a user edit or delete its new revision', async () => {
  const service = createMotionService(await folder())
  const project = (await service.create('launch', 'Film')).projects[0]!
  const result = await Promise.allSettled(
    ['User', 'Agent'].map((title) => service.update(project.id, 1, { ...project.document, title })),
  )
  expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
  expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1)
  const current = await service.get(project.id)
  expect(current.revision).toBe(2)
  await expect(service.remove(project.id, 1)).rejects.toMatchObject({ code: 'conflict' })
  expect((await service.get(project.id)).document.title).toBe(current.document.title)
})
test('assets and resource expansion are scoped to their workspace; unknown references are refused', async () => {
  const dir = await folder()
  const service = createMotionService(dir)
  const state = await service.upload('image.png', 'image/png', new Uint8Array([137, 80, 78, 71]))
  const asset = state.assets[0]!
  const document = createTemplateDocument('launch')
  document.scenes[1]!.imageId = asset.id
  const created = (await service.create('launch', document.title, document)).projects[0]!
  await expect(
    createMotionService(await folder()).create('launch', document.title, document),
  ).rejects.toMatchObject({ code: 'invalid_asset' })
  await expect(createMotionService(await folder()).readAsset(asset.id)).rejects.toMatchObject({
    code: 'not_found',
  })
  const otherDir = await folder()
  const provider = createMotionResourceProvider(async (userId, sessionId) =>
    sessionId === 'live' ? createMotionService(userId === 'owner' ? dir : otherDir) : null,
  )
  const resources = await provider.listChildren('owner', null, undefined, { sessionId: 'live' })
  expect(resources).toHaveLength(1)
  expect(await provider.expand('other', resources[0]!.uri, { sessionId: 'live' })).toEqual({
    ok: false,
  })
  expect(await provider.expand('owner', resources[0]!.uri, { sessionId: 'live' })).toMatchObject({
    ok: true,
  })
  expect((await service.get(created.id)).document.scenes[1]!.imageId).toBe(asset.id)
})
test('HTTP validates updates, reports conflicts and refuses traversal and disguised assets', async () => {
  const app = createMotionRoutes()
  const env = { userId: 'owner', sessionId: 'live', projectId: '', cwd: await folder() }
  const request = (path: string, body?: unknown, method = body ? 'POST' : 'GET') =>
    app.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
    )
  const created = await (await request('/projects', { template: 'report', title: 'Report' })).json()
  const project = created.projects[0]
  expect(
    (
      await request(
        `/projects/${project.id}`,
        { revision: 1, document: { ...project.document, title: 'Edited' } },
        'PUT',
      )
    ).status,
  ).toBe(200)
  const stale = await request(
    `/projects/${project.id}`,
    { revision: 1, document: project.document },
    'PUT',
  )
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ error: { code: 'conflict' } })
  expect(
    (
      await request(
        `/projects/${project.id}`,
        { revision: 2, document: { ...project.document, scenes: [] } },
        'PUT',
      )
    ).status,
  ).toBe(400)
  expect((await request('/assets/not-a-uuid')).status).toBe(404)
  expect(
    (
      await request('/assets', {
        name: 'x.png',
        mime: 'image/png',
        base64: btoa('<script>bad</script>'),
      })
    ).status,
  ).toBe(400)
  expect(
    (await request('/assets', { name: 'x.svg', mime: 'image/svg+xml', base64: btoa('<svg/>') }))
      .status,
  ).toBe(400)
  expect((await request('/library', undefined)).status).toBe(200)
  const other = await app.request(`/assets/${crypto.randomUUID()}`, {}, { ...env, userId: 'other' })
  expect(other.status).toBe(404)
})

test('saved media references protect files from deletion and unused files can be reclaimed', async () => {
  const service = createMotionService(await folder())
  const assets = await service.upload('image.png', 'image/png', new Uint8Array([137, 80, 78, 71]))
  const id = assets.assets[0]!.id
  const document = createTemplateDocument('launch')
  document.scenes[1]!.imageId = id
  const project = (await service.create('launch', document.title, document)).projects[0]!
  await expect(service.removeAsset(id)).rejects.toMatchObject({ code: 'conflict' })
  expect((await service.readAsset(id)).bytes.length).toBe(4)
  document.scenes[1]!.imageId = null
  await service.update(project.id, project.revision, document)
  expect((await service.removeAsset(id)).assets).toEqual([])
  await expect(service.readAsset(id)).rejects.toMatchObject({ code: 'not_found' })
})

test('workspace storage refuses an escaped .localix or assets symlink and requires a conversation', async () => {
  const workspace = await folder()
  const outside = await folder()
  await symlink(outside, join(workspace, '.localix'))
  await expect(createMotionService(workspace).list()).rejects.toThrow('inside the workspace')
  const safe = await folder()
  const service = createMotionService(safe)
  await service.list()
  await symlink(outside, join(safe, '.localix/motion/assets'))
  await expect(service.upload('escape.png', 'image/png', new Uint8Array([1]))).rejects.toThrow(
    'inside its workspace',
  )
  const response = await createMotionRoutes().request(
    '/library',
    {},
    { userId: 'owner', cwd: safe },
  )
  expect(response.status).toBe(409)
})
