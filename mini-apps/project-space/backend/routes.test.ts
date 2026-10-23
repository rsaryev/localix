import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'
import { createSpaceRoutes } from './routes'
import { spacePaths } from './paths'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A fresh project folder, and the routes called the way the host calls them: the scope as env. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'project-space-'))
  roots.push(root)
  const app = createSpaceRoutes()
  const scope: MiniAppRouteScope = { userId: 'u1', sessionId: 's1', projectId: 'p1', cwd: root }
  const send = async (method: string, path: string, body?: unknown, raw?: BodyInit) => {
    const response = await app.request(
      path,
      {
        method,
        ...(raw !== undefined
          ? { body: raw }
          : body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      },
      scope,
    )
    return { status: response.status, response, json: () => response.json() as Promise<any> }
  }
  return { root, send }
}

describe('the board routes', () => {
  test('a first read is an empty board; an operation creates the file in the project', async () => {
    const { root, send } = project()
    expect((await (await send('GET', '/space')).json()).space.elements).toEqual({})
    const created = await (
      await send('POST', '/ops', { ops: [{ op: 'create', type: 'note', id: 'n1', text: 'Hi' }] })
    ).json()
    expect(created.results).toEqual([{ ok: true, id: 'n1' }])
    const file = JSON.parse(readFileSync(spacePaths(root).file, 'utf8'))
    expect(file.elements.n1.props.text).toBe('Hi')
  })

  test('undo reverses the person’s change and redo brings it back', async () => {
    const { send } = project()
    await send('POST', '/ops', { ops: [{ op: 'create', type: 'note', id: 'n1' }] })
    const undone = await (await send('POST', '/undo')).json()
    expect(undone.space.elements.n1).toBeUndefined()
    expect(undone.canRedo).toBe(true)
    expect((await (await send('POST', '/redo')).json()).space.elements.n1).toBeDefined()
  })

  test('a board file broken by hand is reported and never overwritten', async () => {
    const { root, send } = project()
    mkdirSync(spacePaths(root).dir, { recursive: true })
    writeFileSync(spacePaths(root).file, '{ "format": "localix.project-space", oops')
    const read = await (await send('GET', '/space')).json()
    expect(read.writable).toBe(false)
    const write = await send('POST', '/ops', { ops: [{ op: 'create', type: 'note' }] })
    expect(write.status).toBe(409)
    expect(readFileSync(spacePaths(root).file, 'utf8')).toContain('oops')
  })

  test('a reference that is gone is reported as missing', async () => {
    const { root, send } = project()
    writeFileSync(join(root, 'here.ts'), 'export {}')
    const ops = [
      { op: 'create', type: 'file', id: 'ok', props: { path: 'here.ts' } },
      { op: 'create', type: 'file', id: 'gone', props: { path: 'nowhere.ts' } },
    ]
    expect((await (await send('POST', '/ops', { ops })).json()).missing).toEqual(['gone'])
  })

  test('a path inside the project is stored relative, whoever wrote it absolute', async () => {
    const { root, send } = project()
    const ops = [
      { op: 'create', type: 'file', id: 'in', props: { path: join(root, 'src', 'a.ts') } },
      { op: 'create', type: 'file', id: 'out', props: { path: '/elsewhere/b.ts' } },
    ]
    const { space } = await (await send('POST', '/ops', { ops })).json()
    expect(space.elements.in.props.path).toBe('src/a.ts')
    expect(space.elements.out.props.path).toBe('/elsewhere/b.ts')
  })

  test('file routes read the project and what the board references — nothing else', async () => {
    const { root, send } = project()
    writeFileSync(join(root, 'a.ts'), 'const a = 1\n')
    expect((await (await send('GET', '/text?path=a.ts')).json()).text).toBe('const a = 1\n')
    expect((await send('GET', '/text?path=../../etc/hosts')).status).toBe(404)
    expect((await send('GET', `/raw?path=${encodeURIComponent('/etc/hosts')}`)).status).toBe(404)
  })

  test('a pasted file is kept beside the board once, and referenced by a project path', async () => {
    const { root, send } = project()
    const bytes = new Uint8Array([137, 80, 78, 71])
    const first = await (
      await send('POST', '/files?name=Screen%20Shot.png', undefined, bytes)
    ).json()
    const second = await (await send('POST', '/files?name=again.png', undefined, bytes)).json()
    expect(first.path).toMatch(/^\.localix\/project-space\/files\/[0-9a-f]{12}-Screen_Shot\.png$/u)
    expect(second.path).not.toBe(first.path)
    expect(readFileSync(join(root, first.path)).byteLength).toBe(4)
    const folder = await (
      await send('GET', `/folder?path=${encodeURIComponent('.localix/project-space/files')}`)
    ).json()
    expect(folder.total).toBe(2)
  })
})
