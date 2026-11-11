import { expect, test } from 'bun:test'
import { createModComposer } from '../composer'
import { INERT_MOD_PORTS, NO_USAGE, type ModsPorts } from '../contracts'
import { createSessionInterface } from './session-interface'
import { createSessionPorts } from './session-ports'

const scene = { userId: 'u', sessionId: 's1', cwd: '/work' }
const signal = new AbortController().signal

function portsWith(overrides: Partial<ModsPorts> = {}) {
  const composer = createModComposer(() => {})
  const ports = createSessionPorts({
    ports: { ...INERT_MOD_PORTS, ...overrides },
    scene,
    composer,
    builtIns: () => ['help'],
  })
  return { ports, composer }
}

test('a completion is Localix’s route, its blocks joined; an empty reply is empty-reply', async () => {
  const asked: unknown[] = []
  const { ports } = portsWith({
    complete: async (_scene, request) => {
      asked.push([request.prompt, request.system, request.model])
      return { isAnswered: true, text: '', usage: NO_USAGE }
    },
  })
  const result = await ports.models.complete({
    model: 'haiku',
    prompt: [{ text: 'a' }, { text: 'b' }],
    system: [{ text: 's' }],
    maxTokens: 5,
    signal,
  })
  expect(result).toEqual({ isAnswered: false, reason: 'empty-reply' })
  expect(asked).toEqual([['ab', 's', 'haiku']])
})

test('a fork with no conversation yet says nothing-to-fork', async () => {
  const { ports } = portsWith()
  expect(await ports.models.fork({ prompt: [{ text: 'q' }], signal })).toEqual({
    isAnswered: false,
    reason: 'nothing-to-fork',
  })
})

test('an appended row is noted for the next prompt; one with no text is refused', async () => {
  const { ports, composer } = portsWith()
  const row = { message: { type: 'user', content: [{ type: 'text', text: 'note' }] } }
  expect(await ports.session.append(row, signal)).toMatchObject({ message: { type: 'user' } })
  expect(composer.takeNotes('s1')).toEqual(['note'])
  expect(await ports.session.append({ message: { content: [] } }, signal)).toEqual({
    deny: '$.session.append takes text blocks',
  })
})

test('what Localix never had is refused with the reason; a call with no turn says so', async () => {
  const { ports } = portsWith()
  expect(await ports.session.send('peer', 'hi', signal)).toEqual({
    isDelivered: false,
    reason: 'Localix delivers between conversations through its own agents, not a mod',
  })
  expect(await ports.config.set('theme', 'dark')).toEqual({
    deny: 'Localix has no /config row named theme',
  })
  expect(await ports.agents.spawn({ prompt: 'p' }, signal)).toEqual({
    deny: 'Subagents start from a running turn of a conversation',
  })
  await expect(ports.turns.abort()).rejects.toThrow('$.turn.abort')
})

test('$.model.classify asks the route for one label: the one it named, or none', async () => {
  const replies = ['"bug".', 'neither']
  const { ports } = portsWith({
    complete: async () => ({ isAnswered: true, text: replies.shift()!, usage: NO_USAGE }),
  })
  const ask = { text: 'it crashes', labels: ['bug', 'feature'] }
  expect(await ports.models.classify(ask, signal)).toBe('bug')
  expect(await ports.models.classify(ask, signal)).toBeUndefined()
})

test('a classify the route does not answer rejects, naming the cause', async () => {
  const { ports } = portsWith({
    complete: async () => ({ isAnswered: false, reason: 'empty-reply', usage: NO_USAGE }),
  })
  await expect(ports.models.classify({ text: 't', labels: ['a', 'b'] }, signal)).rejects.toThrow(
    '$.model.classify: empty-reply',
  )
})

test('a prompt a mod submits is marked, so its turn does not fire prompt.submit again', async () => {
  const sent: string[] = []
  const { ports, composer } = portsWith({ submitPrompt: async (_s, p) => void sent.push(p.text) })
  await ports.prompts.submit({ text: 'go on', from: 'lab' })
  expect(sent).toEqual(['go on'])
  // Marked as the model reads it: Claude names the sender.
  expect(composer.takeSubmitted('s1', '[lab] go on')).toBe(true)
})

test('the conversation’s subagents list as Claude Code names them', async () => {
  const { ports } = portsWith({
    listAgentRuns: async () => [
      { sessionId: 'c1', taskName: 'Read', status: 'running' },
      { sessionId: 'c2', taskName: 'Old', status: 'stopped', parentSessionId: 's1' },
    ],
  })
  expect(await ports.agents.list()).toEqual([
    { id: 'c1', name: 'Read', description: 'Read', type: 'self', status: 'running' },
    { id: 'c2', name: 'Old', description: 'Old', type: 'self', status: 'killed', parentId: 's1' },
  ])
})

test('the interface draws on the desktop: a status line by mod, a redraw a poke', () => {
  let pokes = 0
  const composer = createModComposer(() => {})
  const iface = createSessionInterface({
    ports: { ...INERT_MOD_PORTS, changed: () => void pokes++ },
    scene,
    composer,
    rerun: () => {},
  })
  iface.status('⚠ meter: 3 left')
  iface.redraw()
  expect(iface.surface()).toBe('desktop')
  expect(composer.view('s1').statuses).toEqual({ meter: '⚠ meter: 3 left' })
  expect(pokes).toBe(1)
})

test('a question goes on the turn’s card, a notice is a line, a raster call is refused', async () => {
  const lines: string[] = []
  const composer = createModComposer(() => {})
  const iface = createSessionInterface({
    ports: { ...INERT_MOD_PORTS, log: (_s, { text }) => void lines.push(text) },
    scene,
    composer,
    rerun: () => {},
    turn: { ask: async (request) => `${request.question} → ${request.options[1]}` },
  })
  expect(await iface.ask({ question: 'How?', options: ['Bold', 'Careful'] })).toBe('How? → Careful')
  await iface.notice({ tool_use_id: 't1', text: 'checked' })
  await iface.notice({ tool_use_id: 't1' })
  expect(lines).toEqual(['checked'])
  expect(await iface.blit({})).toEqual({ deny: 'the desktop surface draws no terminal raster' })
})
