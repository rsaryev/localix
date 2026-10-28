import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'

import type { BoardEvent, KanbanMove, KanbanTask } from '../../shared/contracts'
import { BOARD_FRAME_TAG, ROUTE_PATH } from '../../shared/resource'

/**
 * The board's backend and the host's realtime socket, as test doubles bound to the SDK — the
 * seams the view actually talks through, so a test drives the real client, store and hooks.
 *
 * Every request is recorded WITH the session it named: the view's first rule is that it only ever
 * talks about the chat a surface belongs to, and a test can only prove that by reading the query.
 */

interface RecordedRequest {
  method: string
  path: string
  sessionId: string | null
  body?: unknown
}

export const card = (over: Partial<KanbanTask> & { id: string }): KanbanTask => ({
  seq: Number(over.id.replace(/\D+/g, '')) || 1,
  title: over.id,
  description: '',
  status: 'backlog',
  kind: 'task',
  parentTaskId: null,
  agentId: null,
  assignee: null,
  error: null,
  dependsOn: [],
  attachedPaths: [],
  labels: [],
  priority: 0,
  artifacts: [],
  subtasks: [],
  origin: 'user',
  sortOrder: 1,
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
  ...over,
})

export function fakeBoardBackend(initial: Record<string, KanbanTask[]> = {}) {
  const boards = new Map(Object.entries(initial).map(([id, tasks]) => [id, [...tasks]]))
  const requests: RecordedRequest[] = []
  const realtime: Record<string, unknown>[] = []
  const opened: unknown[] = []
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  let refusal: { status: number; code: string; message: string } | null = null
  let stamp = Date.parse('2026-09-26T11:00:00.000Z')
  const next = () => new Date((stamp += 1000)).toISOString()

  const reply = (body: unknown, status = 200) =>
    body === undefined ? new Response(null, { status: 204 }) : Response.json(body, { status })

  function answer(method: string, route: string, sessionId: string, body: unknown): Response {
    const tasks = boards.get(sessionId) ?? []
    boards.set(sessionId, tasks)
    const id = decodeURIComponent(route.split('/')[2] ?? '')
    if (route === '/board') return reply({ version: 1, nextSeq: tasks.length + 1, tasks })
    if (route === '/agents') return reply({ agents: [{ id: 'a1', name: 'implementer' }] })
    if (route === '/moves') {
      const moved = (body as { moves: KanbanMove[] }).moves.map((move) => {
        const index = tasks.findIndex((task) => task.id === move.id)
        tasks[index] = { ...tasks[index]!, ...move, updatedAt: next() }
        return tasks[index]!
      })
      return reply({ tasks: moved })
    }
    if (route === '/tasks' && method === 'POST') {
      const created = card({ id: `LX-${tasks.length + 1}`, ...(body as object), updatedAt: next() })
      tasks.push(created)
      return reply(created, 201)
    }
    const index = tasks.findIndex((task) => task.id === id)
    if (index < 0)
      return reply({ error: { code: 'task_not_found', message: `No task ${id}.` } }, 404)
    if (method === 'DELETE') {
      tasks.splice(index, 1)
      return reply(undefined)
    }
    if (method === 'PATCH') {
      const { expectedUpdatedAt: _stale, ...patch } = body as Record<string, unknown>
      tasks[index] = { ...tasks[index]!, ...patch, updatedAt: next() }
    }
    return reply(tasks[index])
  }

  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const url = new URL(path, 'http://localix.test')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      const sessionId = url.searchParams.get('sessionId')
      requests.push({ method, path: url.pathname, sessionId, ...(body ? { body } : {}) })
      if (refusal) {
        const { status, ...error } = refusal
        refusal = null
        return reply({ error }, status)
      }
      if (!sessionId) return reply({ error: { code: 'no_board', message: 'No chat.' } }, 404)
      return answer(method, url.pathname.slice(ROUTE_PATH.length), sessionId, body)
    },
  })

  const unbindRuntime = bindMiniAppUiRuntime({
    workspace: {
      openWorkItem: (request: unknown) => opened.push(request),
      openFile: (request: unknown) => opened.push(request),
    },
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== BOARD_FRAME_TAG) return () => {}
        frames.add(handler)
        return () => frames.delete(handler)
      },
      onReconnect: (handler: () => void) => {
        reconnects.add(handler)
        return () => reconnects.delete(handler)
      },
      onDisconnect: () => () => {},
      request: async (payload: Record<string, unknown>) => {
        realtime.push(payload)
        return {}
      },
    },
  } as unknown as MiniAppUiRuntime)

  return {
    boards,
    requests,
    realtime,
    opened,
    /** Requests that read a board, per session. */
    reads: (sessionId: string) =>
      requests.filter((r) => r.path.endsWith('/board') && r.sessionId === sessionId).length,
    /** A change someone else made, as the socket delivers it. */
    push: (event: BoardEvent) => {
      for (const handler of Array.from(frames)) handler(JSON.stringify(event))
    },
    reconnect: () => {
      for (const handler of Array.from(reconnects)) handler()
    },
    /** The next request answers with this refusal instead. */
    refuseNext: (status: number, code: string, message: string) => {
      refusal = { status, code, message }
    },
    unbind: () => {
      unbindTransport()
      unbindRuntime()
    },
  }
}

export type FakeBoardBackend = ReturnType<typeof fakeBoardBackend>
