import { afterEach, describe, expect, test } from 'bun:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { ElicitRequest } from '@modelcontextprotocol/sdk/types.js'
import {
  HumanInLoopDismissedError,
  type AgentToolExecutionContext,
  type HumanInLoopController,
} from '@localixai/agent/agents'

import type {
  McpElicitationHooks,
  McpElicitationRequest,
} from '../agent-core/tools/hitl/mcp-elicitation'
import { answerElicitation, createElicitingClient } from './mcp-elicitation'
import { buildToolForServer } from './mcp-tools'
import type { McpServerRecord } from './repository'

type ElicitParams = ElicitRequest['params']

const FORM: ElicitParams = {
  mode: 'form',
  message: 'Which project?',
  requestedSchema: {
    type: 'object',
    properties: {
      project_key: { type: 'string', title: 'Project key', minLength: 2 },
      count: { type: 'integer', minimum: 1 },
    },
    required: ['project_key'],
  },
}

const record: McpServerRecord = {
  id: 'srv-1',
  userId: 'u',
  projectId: '',
  name: 'issue-tracker',
  description: '',
  transport: 'stdio',
  config: {},
  createdAt: '',
  updatedAt: '',
}

/** A HITL controller whose person answers with `answer` (or throws it). */
function person(answer: unknown | Error) {
  const cards: McpElicitationRequest[] = []
  const controller = {
    async request(request: McpElicitationRequest) {
      cards.push(request)
      if (answer instanceof Error) throw answer
      return { requestId: request.id, kind: request.kind, payload: { answers: answer } }
    },
  } as unknown as HumanInLoopController
  return { cards, controller }
}

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.()
})

/** A real SDK server whose one tool elicits `params` and returns what it got back. */
async function connectedTool(params: ElicitParams) {
  const server = new McpServer({ name: 'issue-tracker', version: '1.0.0' })
  server.registerTool('pick_project', { description: 'Ask which project' }, async () => {
    const result = await server.server.elicitInput(params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = createElicitingClient({ name: 'localix', version: '1.0.0' })
  await client.connect(clientSide)
  closers.push(async () => {
    await client.close()
    await server.close()
  })
  const tool = buildToolForServer(record, client, {
    name: 'pick_project',
    inputSchema: { type: 'object', properties: {} },
  })
  return async (
    context: AgentToolExecutionContext & { mcpElicitationHooks?: McpElicitationHooks },
  ) => {
    const result = await tool.execute('call-1', {}, undefined, undefined, context)
    return JSON.parse(String(result.content)) as { action: string; content?: unknown }
  }
}

describe('MCP elicitation', () => {
  test('a server asks during a tool call and the card in that chat answers it', async () => {
    const run = await connectedTool(FORM)
    const { cards, controller } = person({ action: 'accept', content: { project_key: 'DOCS' } })

    expect(await run({ humanInLoop: controller })).toEqual({
      action: 'accept',
      content: { project_key: 'DOCS' },
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]?.id).toBe('call-1')
    expect(cards[0]?.kind).toBe('mcp_elicitation')
    expect(cards[0]?.expiresAt).toBeGreaterThan(Date.now())
    expect(cards[0]?.payload).toMatchObject({
      server: 'issue-tracker',
      message: 'Which project?',
      mode: 'form',
    })
  })

  test('content that does not fit the requested form declines', async () => {
    const run = await connectedTool(FORM)
    const { controller } = person({ action: 'accept', content: { project_key: 'D', extra: 1 } })
    expect(await run({ humanInLoop: controller })).toEqual({ action: 'decline' })
  })

  test('Decline is a decline; dismissing the card (Esc) is a cancel', async () => {
    const declined = await connectedTool(FORM)
    expect(await declined({ humanInLoop: person({ action: 'decline' }).controller })).toEqual({
      action: 'decline',
    })
    const dismissed = await connectedTool(FORM)
    const { controller } = person(new HumanInLoopDismissedError())
    expect(await dismissed({ humanInLoop: controller })).toEqual({ action: 'cancel' })
  })

  test('an unattended run raises no card and cancels', async () => {
    const run = await connectedTool(FORM)
    const { cards, controller } = person({ action: 'accept', content: { project_key: 'DOCS' } })
    expect(await run({ humanInLoop: controller, interactive: false })).toEqual({ action: 'cancel' })
    expect(cards).toHaveLength(0)
  })

  test('an Elicitation hook answers for the person: no card, and no ElicitationResult', async () => {
    const run = await connectedTool(FORM)
    const { cards, controller } = person({ action: 'decline' })
    let after = 0
    const hooks: McpElicitationHooks = {
      before: async (request) => {
        expect(request.server).toBe('issue-tracker')
        expect(request.requestedSchema?.properties.project_key).toBeDefined()
        return { action: 'accept', content: { project_key: 'DOCS' } }
      },
      after: async () => {
        after++
        return undefined
      },
    }
    expect(await run({ humanInLoop: controller, mcpElicitationHooks: hooks })).toEqual({
      action: 'accept',
      content: { project_key: 'DOCS' },
    })
    expect(cards).toHaveLength(0)
    expect(after).toBe(0)
  })

  test("an ElicitationResult hook replaces the person's answer", async () => {
    const run = await connectedTool(FORM)
    const { controller } = person({ action: 'accept', content: { project_key: 'DOCS' } })
    const hooks: McpElicitationHooks = {
      before: async () => undefined,
      after: async (_request, answer) => {
        expect(answer).toEqual({ action: 'accept', content: { project_key: 'DOCS' } })
        return { action: 'accept', content: { project_key: 'DOCS-2', count: 3 } }
      },
    }
    expect(await run({ humanInLoop: controller, mcpElicitationHooks: hooks })).toEqual({
      action: 'accept',
      content: { project_key: 'DOCS-2', count: 3 },
    })
  })

  test('a request while no call of that client runs is cancelled', async () => {
    expect(await answerElicitation({}, FORM)).toEqual({ action: 'cancel' })
  })

  test('URL mode carries the link to the card and accepts without content', async () => {
    const run = await connectedTool({
      mode: 'url',
      message: 'Sign in',
      url: 'https://auth.example.com/login',
      elicitationId: 'e-1',
    })
    const { cards, controller } = person({ action: 'accept', content: { ignored: 'x' } })
    expect(await run({ humanInLoop: controller })).toEqual({ action: 'accept' })
    expect(cards[0]?.payload).toMatchObject({
      mode: 'url',
      url: 'https://auth.example.com/login',
      elicitationId: 'e-1',
    })
  })
})
