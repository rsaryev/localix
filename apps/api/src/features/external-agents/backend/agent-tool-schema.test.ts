import { expect, test } from 'bun:test'
import { externalAgentInputSchema, agentSessionsInput } from './agent-tool-schema'

test('model fields normalize into the existing read-only service contract', () => {
  const parsed = externalAgentInputSchema.parse({
    action: 'roster',
    providers: ['codex'],
    cwd_prefix: '/fixture/project',
    parent_key: 'codex:parent',
    include_children: true,
    timeout_ms: 1000,
    max_events: 25,
    budget_chars: 4000,
    limit: 20,
  })
  expect(agentSessionsInput(parsed)).toEqual({
    action: 'roster',
    providers: ['codex'],
    cwdPrefix: '/fixture/project',
    parentKey: 'codex:parent',
    includeChildren: true,
    timeoutMs: 1000,
    maxEvents: 25,
    budgetChars: 4000,
    limit: 20,
  })
})

test('invalid model bounds fail before any history read', () => {
  expect(
    externalAgentInputSchema.safeParse({ action: 'transcript', max_events: 2001 }).success,
  ).toBe(false)
  expect(externalAgentInputSchema.safeParse({ action: 'roster', limit: 41 }).success).toBe(false)
  expect(externalAgentInputSchema.safeParse({ action: 'wait', timeout_ms: -1 }).success).toBe(false)
  expect(externalAgentInputSchema.safeParse({ action: 'transcript', max_events: 25 }).success).toBe(
    true,
  )
})
