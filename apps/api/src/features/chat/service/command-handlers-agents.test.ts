import { describe, expect, test } from 'bun:test'
import { localixUiUri } from '@localixai/mini-app-sdk/navigation'
import { sessionFixture } from '../../../testing/session-fixture'
import type { AgentSummary } from '../../agents/contracts'
import type { MessageMutationResponse } from '../contracts'
import { handleAgentsControlCommand } from './command-handlers-agents'
import type { CommandHandlerContext } from './command-handlers-context'

const agent: AgentSummary = {
  record: { id: 'native:qa', name: 'qa', description: 'Reviews', instructions: 'Review.' },
  enabled: true,
  projectId: 'p',
  scope: 'project',
  invocations: { chat: 'allow' },
  source: 'user',
  path: '',
  editable: true,
}

function run(prompt: string, available = true) {
  const session = sessionFixture({ projectId: 'p' })
  const replies: string[] = []
  const ctx = {
    deps: { agentManagement: available ? { listAgents: async () => [agent] } : undefined },
  } as unknown as CommandHandlerContext
  return handleAgentsControlCommand(ctx, session.userId, session, prompt, async (text) => {
    replies.push(text)
    return {} as MessageMutationResponse
  }).then(() => replies[0] ?? '')
}

describe('/agents', () => {
  test('list shows agents by name, linked to their Store page', async () => {
    const reply = await run('/agents list')
    expect(reply).toContain('[qa](')
    expect(reply).toContain(
      localixUiUri('work-item', ['store'], { kind: 'agent', id: 'native:qa' }),
    )
    expect(reply).not.toContain('@qa')
  })
  test('anything else points at the Agents shelf of the Store', async () => {
    expect(await run('/agents create x')).toContain(localixUiUri('work-item', ['store', 'agents']))
  })
  test('says so when the host has no agent management', async () => {
    expect(await run('/agents list', false)).toContain('unavailable')
  })
})
