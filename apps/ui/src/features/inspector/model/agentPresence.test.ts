import { expect, test } from 'bun:test'
import { AGENT_LINGER_MS, createAgentPresence, isAgentWorking } from './agentPresence'

function setup() {
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  const presence = createAgentPresence((run, ms) => {
    const timer = { run, ms, cancelled: false }
    timers.push(timer)
    return () => void (timer.cancelled = true)
  })
  const working = (id: string) => isAgentWorking(presence.getState().tabs, id)
  const fire = () => timers.filter((t) => !t.cancelled).forEach((t) => t.run())
  return { presence, timers, working, fire }
}

test('a tab shows the agent at work from the claim and a moment past the reply', () => {
  const { presence, timers, working, fire } = setup()
  expect(working('a')).toBe(false)
  presence.getState().begin('a')
  expect(working('a')).toBe(true)
  presence.getState().end('a')
  // The reply is not the end of the glance: the indicator lingers so a quick click is seen.
  expect(working('a')).toBe(true)
  expect(timers.at(-1)?.ms).toBe(AGENT_LINGER_MS)
  fire()
  expect(working('a')).toBe(false)
})

test('overlapping commands keep the tab working until the last one has answered', () => {
  const { presence, working, fire } = setup()
  presence.getState().begin('a')
  presence.getState().begin('a')
  presence.getState().end('a')
  fire()
  expect(working('a')).toBe(true)
  presence.getState().end('a')
  fire()
  expect(working('a')).toBe(false)
})

test('a new command during the linger is not cut short by the old timer', () => {
  const { presence, working, fire } = setup()
  presence.getState().begin('a')
  presence.getState().end('a')
  presence.getState().begin('a')
  fire()
  expect(working('a')).toBe(true)
  presence.getState().end('a')
  fire()
  expect(working('a')).toBe(false)
})

test('tabs are independent and a closed tab is forgotten', () => {
  const { presence, working } = setup()
  presence.getState().begin('a')
  expect(working('b')).toBe(false)
  presence.getState().forget('a')
  expect(working('a')).toBe(false)
  expect(presence.getState().tabs).toEqual({})
})
