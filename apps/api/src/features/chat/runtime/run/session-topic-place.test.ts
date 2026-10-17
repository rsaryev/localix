import { expect, test } from 'bun:test'

import { speakerPlace } from './session-topic'

const env = {
  deps: {
    listRegistryAgents: async () => [
      { agentId: 'a:localix', leadershipPriority: 2 },
      { agentId: 'a:frontend', leadershipPriority: 0 },
    ],
  },
} as never

const session = {
  projectId: null,
  agents: [
    { agentId: 'a:frontend', handle: 'frontend' },
    { agentId: 'a:localix', handle: 'localix' },
  ],
} as never

test('a member learns the elected leader’s handle; the leader and a solo speaker do not', async () => {
  expect(await speakerPlace(env, 'u1', session, 'a:frontend')).toEqual({
    role: 'member',
    leader: 'localix',
  })
  expect(await speakerPlace(env, 'u1', session, 'a:localix')).toEqual({ role: 'leader' })
  const solo = { projectId: null, agents: [{ agentId: 'a:localix', handle: 'localix' }] } as never
  expect(await speakerPlace(env, 'u1', solo, 'a:localix')).toEqual({ role: 'solo' })
})
