import { describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { AgentSummary } from '../agents/contracts'
import type { RemedyPorts } from './contracts'
import { createConfigProposalService } from './service'

describe('applying an approved proposal', () => {
  const setup = (agent: AgentSummary | null) => {
    const writes: string[] = []
    const ports = {
      rules: {
        readSnapshot: async () => ({ revision: 0, rules: [] }),
        mutate: async (_user: string, agentId: string) => {
          writes.push(agentId)
        },
      },
      agents: { listAgents: async () => [], getAgent: async () => agent },
      bumpCapabilityRevision: () => {},
    } as unknown as RemedyPorts
    const service = createConfigProposalService({ db: {} as Kysely<AppDatabase>, ports })
    const host = service.hostFor({
      userId: 'u',
      sessionId: 's',
      projectId: null,
      agentId: 'cc:gone',
    })
    return { host, writes }
  }

  test('refuses an agent that was deleted after it proposed, and writes no rules for it', async () => {
    const { host, writes } = setup(null)
    await expect(
      host.apply({ change: { kind: 'tool.enable', name: 'bash' }, proposalId: 'p1' }),
    ).rejects.toThrow(/no longer exists/i)
    expect(writes).toEqual([])
  })

  test('writes for an agent that is still there', async () => {
    const { host, writes } = setup({ record: { id: 'cc:gone' } } as AgentSummary)
    await host.apply({ change: { kind: 'tool.enable', name: 'bash' }, proposalId: 'p2' })
    expect(writes).toEqual(['cc:gone'])
  })
})
