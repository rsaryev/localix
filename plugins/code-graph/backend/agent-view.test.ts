import { expect, test } from 'bun:test'
import {
  awaitGraphReportSince,
  awaitGraphView,
  clearAgentView,
  readAgentView,
  readGraphView,
  reportGraphView,
  requestGraphReport,
  showInView,
  subscribeAgentView,
  type AgentViewEvent,
} from './agent-view'

test('an open tab is pushed each request; a late tab gets a fresh one, never an expired move', () => {
  const root = '/fixture/command-delivery'
  showInView(root, 'chat', { highlight: [], requestedAt: Date.now() - 20_000 })
  const late: AgentViewEvent[] = []
  const offLate = subscribeAgentView(root, 'chat', (event) => late.push(event))
  // Expired: replaying it would move a camera the person has moved since.
  expect(late).toEqual([])
  const command = showInView(root, 'chat', { highlight: [], requestedAt: Date.now() })
  expect(late).toEqual([{ kind: 'agent', agent: command }])
  const other: AgentViewEvent[] = []
  const offOther = subscribeAgentView(root, 'other-chat', (event) => other.push(event))
  const opened: AgentViewEvent[] = []
  const offOpened = subscribeAgentView(root, 'chat', (event) => opened.push(event))
  expect(opened).toEqual([{ kind: 'agent', agent: command }])
  offLate()
  showInView(root, 'chat', { highlight: [], requestedAt: Date.now() })
  expect(late).toHaveLength(1)
  expect(opened).toHaveLength(2)
  expect(other).toEqual([])
  offOpened()
  offOther()
  clearAgentView(root, 'chat')
})

test('a report is asked of the open tab and answered by the next report it sends', async () => {
  const root = '/fixture/report-request'
  // Nobody listening: the caller is told so instead of waiting out a timeout.
  expect(requestGraphReport(root, 'chat')).toBe(false)
  const asks: AgentViewEvent[] = []
  const off = subscribeAgentView(root, 'chat', (event) => asks.push(event))
  const since = Date.now()
  expect(requestGraphReport(root, 'chat')).toBe(true)
  expect(asks.map((event) => event.kind)).toEqual(['report'])
  const answer = awaitGraphReportSince(root, 'chat', since, 200)
  const report = {
    revision: 0,
    scope: 'dir:',
    trail: [],
    selected: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    size: { width: 800, height: 600 },
    visible: ['file:a.ts'],
  }
  reportGraphView(root, 'chat', report)
  expect(await answer).toEqual(report)
  expect(readGraphView(root, 'chat')).toEqual(report)
  off()
  expect(requestGraphReport(root, 'chat')).toBe(false)
  // The last tab closing forgets its camera: nothing per chat outlives the tab that made it.
  expect(readGraphView(root, 'chat')).toBeUndefined()
})

test('commands and reports belong to a chat as well as a project', async () => {
  const root = '/fixture/session-isolation'
  const request = showInView(root, 'chat-a', { scope: 'dir:src', highlight: ['file:src/a.ts'] })
  expect(readAgentView(root, 'chat-a')).toEqual(request)
  expect(readAgentView(root, 'chat-b')).toBeUndefined()
  const report = {
    revision: request.revision,
    scope: 'dir:src',
    trail: [],
    selected: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    size: { width: 800, height: 600 },
    visible: ['file:src/a.ts'],
  }
  const pending = awaitGraphView(root, 'chat-a', request.revision, 50)
  reportGraphView(root, 'chat-b', report)
  expect(readGraphView(root, 'chat-a')).toBeUndefined()
  reportGraphView(root, 'chat-a', report)
  expect(await pending).toEqual(report)
  clearAgentView(root, 'chat-b')
  expect(readAgentView(root, 'chat-a')).toEqual(request)
  clearAgentView(root, 'chat-a')
})

test('only the matching request confirms a camera move; older reports never overwrite it', async () => {
  const root = '/fixture/report-order'
  const report = {
    revision: 10,
    scope: 'dir:src',
    trail: [],
    selected: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    size: { width: 800, height: 600 },
    visible: [],
  }
  reportGraphView(root, 'chat', report)
  reportGraphView(root, 'chat', { ...report, revision: 9 })
  expect(readGraphView(root, 'chat')?.revision).toBe(10)
  expect(await awaitGraphView(root, 'chat', 11, 5)).toBeNull()
})
