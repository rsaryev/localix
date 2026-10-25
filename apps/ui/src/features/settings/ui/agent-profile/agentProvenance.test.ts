import { expect, test } from 'bun:test'
import type { AgentSummary } from '@/shared/api/contracts'
import { agentProvenance } from './agentProvenance'

const agent = (over: Partial<AgentSummary> = {}): AgentSummary =>
  ({
    record: { id: 'builtin:lead', handle: 'lead', instructions: 'x' },
    editable: false,
    enabled: true,
    source: 'builtin',
    path: '',
    projectId: '',
    scope: 'global',
    invocations: { chat: 'allow' },
    ...over,
  }) as AgentSummary

test('a profile says where a read-only definition comes from and how to change it', () => {
  expect(agentProvenance(agent({ source: 'plugin:review-pack' }))).toContain('review-pack')
  expect(agentProvenance(agent({ source: 'managed' }))).toContain('organization')
  expect(agentProvenance(agent())).toContain('Copy it to Yours')
  // A file the person owns says nothing: the fields take the edit.
  expect(
    agentProvenance(
      agent({ source: 'user', editable: true, path: '/home/u/.claude/agents/lead.md' }),
    ),
  ).toBeUndefined()
})
