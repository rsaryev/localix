import { afterEach, describe, expect, it } from 'bun:test'

import { createMcpClientManager } from '../../mcp/client-manager'
import type { McpClientLike } from '../../mcp/mcp-wire'
import { McpAuthenticationRequiredError } from '../../mcp/mcp-connect'
import type { McpServerRecord } from '../../mcp/repository'
import { createMcpConditions } from './mcp'
import { createTestJournal, openRows, TEST_USER as U, type TestJournal } from './test-journal'

const journals: TestJournal[] = []
afterEach(async () => {
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

const server = (over: Partial<McpServerRecord> = {}): McpServerRecord => ({
  id: 'srv-1',
  userId: U,
  projectId: '',
  name: 'github',
  description: '',
  transport: 'stdio',
  config: { command: ['fake-server'] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const client = (): McpClientLike => ({
  onclose: undefined,
  listTools: async () => ({ tools: [] }),
  callTool: async () => ({ content: [], isError: false }),
  close: async () => {},
})

/** A manager whose connect answers from `outcomes`, one per attempt; the last one repeats. */
async function setup(outcomes: Array<Error | 'ok'>) {
  const test = await createTestJournal()
  journals.push(test)
  let attempt = 0
  const manager = createMcpClientManager({
    connect: async () => {
      const outcome = outcomes[Math.min(attempt++, outcomes.length - 1)]
      if (outcome instanceof Error) throw outcome
      return client()
    },
  })
  manager.observeConnections(createMcpConditions(test.journal))
  return { test, manager }
}

describe('an MCP server that does not connect', () => {
  it('is one row across repeated failures, settled by the connect that works, reopened after', async () => {
    const refused = new Error('spawn fake-server ENOENT')
    const { test, manager } = await setup([refused, refused, 'ok', refused])
    await manager.probe(server(), '/w')
    await manager.probe(server(), '/w')
    expect((await openRows(test)).map((row) => [row.title, row.body])).toEqual([
      ['Could not connect to the MCP server “github”', 'spawn fake-server ENOENT'],
    ])

    expect((await manager.probe(server(), '/w')).ok).toBe(true)
    expect(await openRows(test)).toEqual([])

    await manager.disposeAll()
    await manager.probe(server(), '/w')
    expect(await openRows(test)).toMatchObject([{ occurrenceCount: 2 }])
  })

  it('asks for a sign-in when the server challenges for OAuth', async () => {
    const { test, manager } = await setup([new McpAuthenticationRequiredError()])
    await manager.probe(server(), '/w')
    expect(await openRows(test)).toMatchObject([
      {
        title: 'Sign in to the MCP server “github”',
        severity: 'warning',
        // The control that does it: the server's own row in Settings → MCP.
        actions: [
          { label: 'Sign in', kind: 'navigate', uri: 'localix://ui/settings/mcp/mcp-github' },
        ],
      },
    ])
  })

  it('keeps a same-named server in another project out of this one’s row', async () => {
    const { test, manager } = await setup([new Error('refused'), 'ok'])
    await manager.probe(server({ id: 'a', projectId: 'P1' }), '/w')
    await manager.probe(server({ id: 'b', projectId: 'P2' }), '/w')
    expect((await openRows(test)).length).toBe(1)
  })
})
