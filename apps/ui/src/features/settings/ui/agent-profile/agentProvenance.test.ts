import { expect, test } from 'bun:test'
import type { AgentSummary } from '@/shared/api/contracts'
import { agentProvenance } from './agentProvenance'

const agent = (over: Partial<AgentSummary> = {}): AgentSummary =>
  ({
    record: { id: 'builtin:lead', handle: 'lead', label: 'Tech Lead', instructions: 'x' },
    builtin: true,
    enabled: true,
    source: 'builtin',
    path: '',
    projectId: '',
    scope: 'global',
    invocations: { chat: 'allow' },
    ...over,
  }) as AgentSummary

test('a profile explains only a form that will not take changes', () => {
  // An extension owns this definition, so the fields are read-only and the line says where to
  // change it instead.
  expect(
    agentProvenance(
      agent({
        registration: { sourceId: 'x', sourceName: 'review-pack', key: 'lead', revision: 1 },
      } as Partial<AgentSummary>),
    ),
  ).toContain('review-pack')

  // A system agent you may override says nothing: the fields take the edit, and a sentence
  // about overrides above them is one the reader steps over on every visit.
  expect(agentProvenance(agent())).toBeUndefined()
  expect(
    agentProvenance(agent({ source: 'user', path: '/home/u/.localix/agents/lead.json' })),
  ).toBeUndefined()
})
