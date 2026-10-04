import { describe, expect, test } from 'bun:test'

import { readAuxAgentRoute } from './aux-assist'

describe('aux assist session model routing', () => {
  test('uses the narrow session reader and preserves missing-session fallback', async () => {
    const calls: [string, string][] = []
    const reader = {
      async getSessionAgentRoute(userId: string, sessionId: string) {
        calls.push([userId, sessionId])
        return {
          providerConnectionId: 'provider-a',
          modelId: 'model-a',
          reasoningEffort: 'high' as const,
          // The route a session answers with carries its origin as well as its model: the
          // resolution chain falls back through the project and the agent card, so a reader
          // that dropped these two fields would make the fallback unreachable from here.
          projectId: 'project-a',
          agentId: 'agent-a',
        }
      },
    }

    expect(await readAuxAgentRoute(reader, 'user-a', 'session-a')).toEqual({
      providerConnectionId: 'provider-a',
      modelId: 'model-a',
      reasoningEffort: 'high',
      projectId: 'project-a',
      agentId: 'agent-a',
    })
    expect(calls).toEqual([['user-a', 'session-a']])

    expect(
      await readAuxAgentRoute(
        {
          async getSessionAgentRoute() {
            throw new Error('missing')
          },
        },
        'user-a',
        'missing',
      ),
    ).toBeNull()
  })
})
