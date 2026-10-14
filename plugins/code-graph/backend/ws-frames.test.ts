import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { graphFrameSchema, type GraphFrame } from '../shared/stream'
import { clearAgentView, requestGraphReport, showInView } from './agent-view'
import { closeProjects, projectIndex } from './indexing/projects'
import { createGraphWsFrames } from './ws-frames'

const roots: string[] = []
afterEach(() => {
  closeProjects()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The tab used to long-poll for requests and POST its camera every second. The stream replaces
 * both: what the agent asks, what a tool wants to know and what the index published arrive as
 * frames for the chat that subscribed — and only for the user the socket belongs to.
 */
test('a subscribed chat is pushed requests, report asks and revisions; stop releases it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'code-graph-stream-'))
  roots.push(root)
  writeFileSync(join(root, 'a.ts'), 'export function a() {}')
  const dataDir = join(root, '.cache')
  const {
    wsFrames: [stream],
  } = createGraphWsFrames(dataDir, {
    resolveSessionRoot: async (userId) => (userId === 'owner' ? root : null),
  })
  const frames: GraphFrame[] = []
  const send = (json: string) => frames.push(graphFrameSchema.parse(JSON.parse(json)))
  const handle = stream!.start({ sessionId: 'chat' }, send, { userId: 'owner' })
  const foreign = stream!.start({ sessionId: 'chat' }, send, { userId: 'stranger' })
  await settle()
  const index = projectIndex(dataDir, root)

  const request = showInView(index.root, 'chat', { highlight: [], requestedAt: Date.now() })
  expect(frames).toEqual([{ sessionId: 'chat', agent: request }])
  expect(requestGraphReport(index.root, 'chat')).toBe(true)
  expect(frames.at(-1)).toMatchObject({ sessionId: 'chat', report: expect.any(Number) })
  await index.refresh()
  expect(frames.at(-1)).toEqual({ sessionId: 'chat', revision: 1 })

  stream!.stop(handle)
  stream!.stop(foreign)
  const count = frames.length
  showInView(index.root, 'chat', { highlight: [], requestedAt: Date.now() })
  index.changed()
  await index.refresh()
  expect(frames).toHaveLength(count)
  expect(requestGraphReport(index.root, 'chat')).toBe(false)
  clearAgentView(index.root, 'chat')
})

test('stopping before the project resolves cannot leak a subscription', async () => {
  const root = mkdtempSync(join(tmpdir(), 'code-graph-stream-stop-'))
  roots.push(root)
  let resolve!: (root: string) => void
  const {
    wsFrames: [stream],
  } = createGraphWsFrames(join(root, '.cache'), {
    resolveSessionRoot: () =>
      new Promise((done) => {
        resolve = done
      }),
  })
  const handle = stream!.start({ sessionId: 'chat' }, () => {}, { userId: 'owner' })
  stream!.stop(handle)
  resolve(root)
  await settle()
  expect(requestGraphReport(projectIndex(join(root, '.cache'), root).root, 'chat')).toBe(false)
})
