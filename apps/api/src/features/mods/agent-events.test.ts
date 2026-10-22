import { expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'

import { hostWithMod } from './testing-host'

test('agent.offer sees a plugin agent type as one, and hides it from delegate too', async () => {
  const delegated: unknown[] = []
  const delegate = defineAgentTool({
    name: 'delegate',
    description: 'delegate',
    activeVerb: 'Delegating',
    inputSchema: z.object({}).passthrough(),
    execute: async (_id, input) => (delegated.push(input), { content: 'started' }),
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

  const [wrapped] = scope.wrapTools([delegate])
  const refused = await wrapped!.execute('t1', { task: 'x', title: 't', agent: 'sec:auditor' })
  expect(refused).toMatchObject({ isError: true })
  expect(offers.at(-1)).toEqual({ agent: 'sec:auditor', source: 'plugin' })
  await wrapped!.execute('t2', { task: 'Review.', title: 'Review', agent: 'sec:reviewer' })
  expect(delegated).toEqual([expect.objectContaining({ agent: 'sec:reviewer' })])
})
