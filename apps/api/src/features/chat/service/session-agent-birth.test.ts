import { expect, test } from 'bun:test'

import { bornAgent } from './session-agent-birth'

const resolve = async (args: { requested?: { agentId?: string } }) => ({
  agentId: args.requested?.agentId ?? 'cc:worker',
  name: 'worker',
})
const parent = {
  agent: {
    agentId: 'cc:main',
    name: 'main',
    modelId: 'parent-model',
    providerConnectionId: 'conn-parent',
    reasoningEffort: 'high' as const,
  },
} as never

/** A starting route that would apply a recent choice or the project's model to a root chat. */
const startingRoute = async () => ({
  modelId: 'recent-or-project-model',
  providerConnectionId: 'conn-other',
  reasoningEffort: 'low' as const,
  modelOrigin: 'recent' as const,
})

test('a subagent with no choice of the person runs on its parent’s route, whatever is remembered', async () => {
  const child = await bornAgent({
    userId: 'u',
    projectId: 'p',
    requested: { agentId: 'cc:worker' },
    explicit: {},
    parent,
    resolve: resolve as never,
    startingRoute: startingRoute as never,
  })
  expect(child).toMatchObject({
    modelId: 'parent-model',
    providerConnectionId: 'conn-parent',
    reasoningEffort: 'high',
  })
})

test('the person’s choice for the agent is the child’s route, effort included', async () => {
  const child = await bornAgent({
    userId: 'u',
    projectId: 'p',
    requested: { agentId: 'cc:worker' },
    explicit: { modelId: 'gpt-6', reasoningEffort: 'low' },
    parent,
    resolve: resolve as never,
    startingRoute: startingRoute as never,
  })
  expect(child).toMatchObject({ modelId: 'gpt-6', reasoningEffort: 'low' })
})
