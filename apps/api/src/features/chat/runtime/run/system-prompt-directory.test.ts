import { expect, test } from 'bun:test'

import type { RunPolicy } from '../../policy/run-policy'
import type { SessionRecord } from '../../repository'
import { agentDirectoryRows, type AgentDirectoryEntry } from './system-prompt-conversation'

const session = { agents: [{ agentId: 'lead', handle: 'lead' }] } as unknown as SessionRecord
const policy = (showsDirectory: boolean) =>
  ({ conversation: { showsDirectory } }) as unknown as RunPolicy

const entry = (over: Partial<AgentDirectoryEntry> & { agentId: string }): AgentDirectoryEntry => ({
  name: over.agentId,
  description: '',
  enabled: true,
  canJoinConversation: true,
  ...over,
})

const registry = [
  entry({ agentId: 'lead' }),
  entry({ agentId: 'scribe', delegable: true, tools: ['read'] }),
  entry({ agentId: 'Explore', canJoinConversation: false, delegable: true }),
  entry({ agentId: 'critic', delegable: false }),
]

test('an open chat lists everyone, marking who a task can go to', () => {
  const rows = agentDirectoryRows(session, policy(true), registry, { canDelegate: true })!
  expect(rows.map((row) => [row.handle, row.available, row.delegable ?? false])).toEqual([
    ['lead', true, false],
    ['scribe', true, true],
    ['Explore', false, true],
    ['critic', true, false],
  ])
  expect(rows[1]!.tools).toEqual(['read'])
})

test('a run no tag reaches lists only who a task can go to, and only if it can delegate', () => {
  const rows = agentDirectoryRows(session, policy(false), registry, { canDelegate: true })!
  expect(rows.map((row) => [row.handle, row.available, row.inConversation])).toEqual([
    ['scribe', false, false],
    ['Explore', false, false],
  ])
  expect(
    agentDirectoryRows(session, policy(false), registry, { canDelegate: false }),
  ).toBeUndefined()
})
