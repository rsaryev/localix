import { expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'

import { hostWithMod } from './testing/testing-host'

test('agent.offer sees a plugin agent type as one, and hides it from Agent too', async () => {
  const started: unknown[] = []
  const agent = defineAgentTool({
    name: 'Agent',
    description: 'Agent',
    activeVerb: 'Delegating',
    inputSchema: z.object({}).passthrough(),
    execute: async (_id, input) => (started.push(input), { content: 'started' }),
  }) as AgentTool
  const offers: unknown[] = []
  const { scope } = await hostWithMod((on) => {
    on('agent.offer', ($, e: any, next) => {
      offers.push({ agent: e.agent, source: e.source })
      return e.agent === 'sec:auditor' ? { isOffered: false } : next(e)
    })
  })
  // The registry's directory and the plugins' types are offered apart; both stay known.
  await scope.offerAgents([{ agentId: 'a1', name: 'checker', description: 'Checks' }])
  const types = await scope.offerAgents([
    { agentId: 'sec:reviewer', name: 'sec:reviewer', description: 'Reviews', source: 'plugin' },
    { agentId: 'sec:auditor', name: 'sec:auditor', description: 'Audits', source: 'plugin' },
  ])
  expect(types.map((agent) => agent.name)).toEqual(['sec:reviewer'])
  expect(offers).toEqual([
    { agent: 'checker', source: 'localix' },
    { agent: 'sec:reviewer', source: 'plugin' },
    { agent: 'sec:auditor', source: 'plugin' },
  ])

  const [wrapped] = scope.wrapTools([agent])
  const refused = await wrapped!.execute('t1', {
    prompt: 'x',
    description: 't',
    subagent_type: 'sec:auditor',
  })
  expect(refused).toMatchObject({ isError: true })
  expect(offers.at(-1)).toEqual({ agent: 'sec:auditor', source: 'plugin' })
  await wrapped!.execute('t2', {
    prompt: 'Review.',
    description: 'Review',
    subagent_type: 'sec:reviewer',
  })
  expect(started).toEqual([expect.objectContaining({ subagent_type: 'sec:reviewer' })])
})
