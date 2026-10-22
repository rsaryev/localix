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
  // Armed after the tab's first read may have run: one revision frame closes that gap.
  expect(frames).toEqual([{ sessionId: 'chat', revision: 0 }])

  const request = showInView(index.root, 'chat', { highlight: [], requestedAt: Date.now() })
  expect(frames.at(-1)).toEqual({ sessionId: 'chat', agent: request })
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

/**
 * A build used to be polled every 1.5 s even with the stream open. Its progress is now pushed —
 * the first move at once, the latest of the rest once per window — and its end supersedes a move
 * still waiting, so the tab never re-reads a stale "parsing" after the map is ready.
 */
test('indexing progress is paced per tab and superseded by the finished revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'code-graph-stream-progress-'))
  roots.push(root)
  writeFileSync(join(root, 'a.ts'), 'export function a() {}')
  writeFileSync(join(root, 'b.ts'), 'export function b() {}')
  const dataDir = join(root, '.cache')
  const timers: Array<{ run: () => void; cancelled: boolean }> = []
  const {
    wsFrames: [stream],
  } = createGraphWsFrames(
    dataDir,
    { resolveSessionRoot: async () => root },
    {
      setTimer: (run) => {
        const timer = { run, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
    },
  )
  const frames: GraphFrame[] = []
  const handle = stream!.start(
    { sessionId: 'chat' },
    (json) => frames.push(graphFrameSchema.parse(JSON.parse(json))),
    { userId: 'owner' },
  )
  await settle()
  frames.length = 0
  const index = projectIndex(dataDir, root)

  // Close the window as the build reaches linking: the moves it held collapse into that one.
  const offProbe = index.watchProgress((status) => {
    if (status.phase === 'linking') timers.at(-1)!.run()
  })
  const refresh = index.refresh()
  // The first move goes at once; the rest wait for the window.
  expect(frames).toEqual([{ sessionId: 'chat', indexing: 'discovering' }])
  await refresh
  offProbe()
  expect(frames).toEqual([
    { sessionId: 'chat', indexing: 'discovering' },
    { sessionId: 'chat', indexing: 'linking' },
    { sessionId: 'chat', revision: 1 },
  ])
  // The window opened by the last move was closed by the end, not left to send a stale move.
  expect(timers).toHaveLength(2)
  expect(timers[1]!.cancelled).toBe(true)

  stream!.stop(handle)
  const count = frames.length
  await index.refresh()
  expect(frames).toHaveLength(count)
})
