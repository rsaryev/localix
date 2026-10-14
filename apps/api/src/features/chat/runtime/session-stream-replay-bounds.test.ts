import { expect, test } from 'bun:test'
import { createSessionStreamRegistry, type StreamEnvelope } from './session-stream-registry'

test('session and user replay retain their suffix caps while sharing envelope references', () => {
  const registry = createSessionStreamRegistry()
  for (let i = 0; i < 2500; i++)
    registry.publish('u', 's', {
      type: 'run.completed',
      sessionId: 's',
      messageId: `m-${i}`,
    })
  const session: StreamEnvelope[] = []
  const global: StreamEnvelope[] = []
  registry.subscribe(
    's',
    (event) => {
      session.push(event)
    },
    { since: '0' },
  )()
  registry.subscribeAll(
    'u',
    (event) => {
      global.push(event)
    },
    { since: '0' },
  )()
  expect(session).toHaveLength(500)
  expect(global).toHaveLength(2000)
  expect(session[0].id).toBe('2001')
  expect(global[0].id).toBe('501')
  expect(session.at(-1)?.id).toBe('2500')
  for (let i = 0; i < session.length; i++) expect(session[i]).toBe(global[i + 1500])
})

test('replay eviction protects active subscribers and retires their old buffers after unsubscribe', () => {
  const registry = createSessionStreamRegistry()
  const stopSession = registry.subscribe('s-0', () => {})
  const stopGlobal = registry.subscribeAll('u-0', () => {})
  const replaySession = (id: string) => {
    const seen: StreamEnvelope[] = []
    registry.subscribe(
      id,
      (event) => {
        seen.push(event)
      },
      { since: '0' },
    )()
    return seen
  }
  const replayUser = (id: string) => {
    const seen: StreamEnvelope[] = []
    registry.subscribeAll(
      id,
      (event) => {
        seen.push(event)
      },
      { since: '0' },
    )()
    return seen
  }
  try {
    for (let i = 0; i < 257; i++)
      registry.publish(`u-${i}`, `s-${i}`, {
        type: 'run.completed',
        sessionId: `s-${i}`,
        messageId: `m-${i}`,
      })
    expect(replaySession('s-0')).toHaveLength(1)
    expect(replayUser('u-0')).toHaveLength(1)
    expect(replaySession('s-1')).toEqual([])
    expect(replayUser('u-1')).toEqual([])
    stopSession()
    stopGlobal()
    registry.publish('u-257', 's-257', {
      type: 'run.completed',
      sessionId: 's-257',
      messageId: 'm-257',
    })
    expect(replaySession('s-0')).toEqual([])
    expect(replayUser('u-0')).toEqual([])
    expect(replaySession('s-256')).toHaveLength(1)
    expect(replayUser('u-256')).toHaveLength(1)
  } finally {
    stopSession()
    stopGlobal()
  }
})
