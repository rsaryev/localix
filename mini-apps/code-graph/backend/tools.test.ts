import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { createGraphTools } from './tools'
import { closeProjects, projectIndex } from './indexing/projects'
import { readAgentView, reportGraphView, subscribeAgentView } from './agent-view'
import type { AgentView } from '../shared/view'
import { createGraphRoutes } from './routes'

/** The next request pushed to the chat's tab — what the open map would receive. */
function nextAgentView(root: string, sessionId: string): Promise<AgentView> {
  return new Promise((resolve) => {
    const off = subscribeAgentView(root, sessionId, (event) => {
      if (event.kind !== 'agent') return
      queueMicrotask(off)
      resolve(event.agent)
    })
  })
}

const roots: string[] = []
afterEach(() => {
  closeProjects()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'code-graph-tools-'))
  roots.push(root)
  writeFileSync(
    join(root, 'a.ts'),
    'export function shared() { return 1 }\nexport function alpha() { return shared() }',
  )
  writeFileSync(join(root, 'b.ts'), 'export function shared() { return 2 }')
  const ctx = {
    cwd: root,
    dataDir: join(root, '.cache'),
    z,
    defineTool: (tool: unknown) => tool,
    ui: { offer: (destination: object) => ({ type: 'ui.navigate', ...destination }) },
  } as unknown as MiniAppContext
  const tools = createGraphTools(ctx)
  await projectIndex(ctx.dataDir, root).ready(20_000)
  const call = (name: string, input: object, sessionId = 'chat-a') =>
    tools
      .find((tool) => tool.name === name)!
      .execute('call', input as never, undefined, undefined, {
        session: { id: sessionId },
      } as never) as Promise<{ content: string; isError?: boolean }>
  return { root: projectIndex(ctx.dataDir, root).root, call, dataDir: ctx.dataDir }
}

test('the camera route validates JSON and confirms the requested move in its own chat', async () => {
  const { root, call, dataDir } = await setup()
  const routes = createGraphRoutes(dataDir)
  const pending = call('code_graph_view', { kind: 'zoom', zoom: 1.5 })
  const request = await nextAgentView(root, 'chat-a')
  const report = {
    revision: request.revision,
    scope: 'dir:',
    trail: [],
    selected: null,
    viewport: { x: 0, y: 0, zoom: 1.5 },
    size: { width: 800, height: 600 },
    visible: ['file:a.ts'],
  }
  const response = await routes.request(
    '/camera/report?sessionId=chat-a',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    },
    { cwd: root },
  )
  expect(response.status).toBe(200)
  expect((await pending).content).toContain('150%')
  const invalid = await routes.request(
    '/camera/report?sessionId=chat-a',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
    { cwd: root },
  )
  expect(invalid.status).toBe(400)
})

test('search scopes namesakes and resolves exact ids and multiword queries', async () => {
  const { call } = await setup()
  const result = await call('code_graph_search', { query: 'shared', scope: 'file:a.ts' })
  expect(result.content).toContain('sym:a.ts#shared')
  expect(result.content).not.toContain('sym:b.ts#shared')
  expect((await call('code_graph_search', { query: 'sym:a.ts#alpha' })).content).toContain(
    'sym:a.ts#alpha',
  )
  expect((await call('code_graph_search', { query: 'a.ts alpha' })).content).toContain(
    'sym:a.ts#alpha',
  )
})

test('show rejects ambiguous targets and opens a bounded lens only in the requesting chat', async () => {
  const { root, call } = await setup()
  expect((await call('code_graph_show', { nodes: ['shared'] })).isError).toBe(true)
  expect(readAgentView(root, 'chat-a')).toBeUndefined()
  expect(
    (await call('code_graph_show', { nodes: ['sym:a.ts#alpha'], mode: 'lens' })).isError,
  ).toBeUndefined()
  expect(readAgentView(root, 'chat-a')).toMatchObject({
    scope: 'file:a.ts',
    trail: ['sym:a.ts#alpha'],
  })
  expect(readAgentView(root, 'chat-b')).toBeUndefined()
  expect((await call('code_graph_show', { nodes: ['file:a.ts'], mode: 'lens' })).isError).toBe(true)
})

test('inspect describes a fresh UI report rather than guessing which nodes are visible', async () => {
  const { root, call } = await setup()
  reportGraphView(root, 'chat-a', {
    revision: 0,
    scope: 'file:a.ts',
    trail: ['sym:a.ts#alpha'],
    selected: null,
    viewport: { x: 100, y: 20, zoom: 1.25 },
    size: { width: 800, height: 600 },
    visible: ['sym:a.ts#alpha'],
  })
  const result = await call('code_graph_view', { kind: 'inspect' })
  expect(result.content).toContain('125%')
  expect(result.content).toContain('sym:a.ts#alpha')
  expect((await call('code_graph_view', { kind: 'inspect' }, 'chat-b')).content).toContain(
    'No fresh report',
  )
})
