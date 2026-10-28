import { expect, test } from 'bun:test'

import { agentDirectoryRows, type AgentDirectoryEntry } from './system-prompt-conversation'

const entry = (over: Partial<AgentDirectoryEntry> & { agentId: string }): AgentDirectoryEntry => ({
  name: over.agentId,
  description: '',
  enabled: true,
  ...over,
})

const registry = [
  entry({ agentId: 'lead' }),
  entry({ agentId: 'scribe', delegable: true, tools: ['read'] }),
  entry({ agentId: 'Explore', delegable: true, self: true }),
  entry({ agentId: 'critic', delegable: false }),
]

test('the directory lists only the agents a task can go to', () => {
  const rows = agentDirectoryRows(registry, { canDelegate: true })!
  expect(rows.map((row) => row.name)).toEqual(['scribe', 'Explore'])
  expect(rows[0]!.tools).toEqual(['read'])
  expect(rows[1]!.self).toBe(true)
})

test('a run that cannot delegate lists nothing', () => {
  expect(agentDirectoryRows(registry, { canDelegate: false })).toBeUndefined()
})
