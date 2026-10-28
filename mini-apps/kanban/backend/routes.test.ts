import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'

import type { KanbanBoard, KanbanTask } from '../shared/contracts'
import { createBoardRoutes } from './routes'
import { createBoardService } from './service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** The routes over fresh storage, called the way the host calls them: the scope as `c.env`. */
function routes(sessionId: string | null = 's1') {
  const root = mkdtempSync(join(tmpdir(), 'kanban-routes-'))
  roots.push(root)
  const agents = { list: async () => [{ id: 'builtin:qa', name: 'qa' }] }
  const app = createBoardRoutes(
    createBoardService({ resolveDir: async (_user, session) => join(root, session), agents }),
    agents,
  )
  // The host puts a session here only once it checked the user owns it.
  const scope: MiniAppRouteScope = {
    userId: 'u1',
    ...(sessionId ? { sessionId } : {}),
    projectId: '',
    cwd: '/',
  }
  const send = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      },
      scope,
    )
  return { send }
}

describe('board routes', () => {
  test('refuse a request without an owned chat before touching any board', async () => {
    const response = await routes(null).send('GET', '/board')
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('no_board')
  })

  test('a person’s card is recorded as the user’s', async () => {
    const { send } = routes()
    const created = await send('POST', '/tasks', { title: 'Write docs', agent: 'qa' })
    expect(created.status).toBe(201)
    expect((await created.json()) as KanbanTask).toMatchObject({
      id: 'LX-1',
      origin: 'user',
      agentId: 'builtin:qa',
    })
    const board = (await (await send('GET', '/board')).json()) as KanbanBoard
    expect(board.tasks.map((task) => task.title)).toEqual(['Write docs'])
  })

  test('a person may not cancel a card: the board’s own rule, as a 409', async () => {
    const { send } = routes()
    await send('POST', '/tasks', { title: 'x' })
    const response = await send('PATCH', '/tasks/LX-1', { status: 'cancelled' })
    expect(response.status).toBe(409)
  })

  test('a drag lands as one batch', async () => {
    const { send } = routes()
    await send('POST', '/tasks', { title: 'a' })
    await send('POST', '/tasks', { title: 'b' })
    const response = await send('POST', '/moves', {
      moves: [
        { id: 'LX-1', status: 'ready', sortOrder: 2 },
        { id: 'LX-2', status: 'ready', sortOrder: 1 },
      ],
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { tasks: KanbanTask[] }).tasks).toHaveLength(2)
  })

  test('delete answers 204 and the card is gone', async () => {
    const { send } = routes()
    await send('POST', '/tasks', { title: 'x' })
    expect((await send('DELETE', '/tasks/LX-1')).status).toBe(204)
    expect((await send('GET', '/tasks/LX-1')).status).toBe(404)
  })

  test('lists the agents a card may be assigned to', async () => {
    const response = await routes().send('GET', '/agents')
    expect(await response.json()).toEqual({ agents: [{ id: 'builtin:qa', name: 'qa' }] })
  })
})
