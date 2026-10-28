import { describe, expect, test } from 'bun:test'

import { DELEGATION_SLOT_CAP } from '../../delegation-budget'
import { builtinToolExposure, TOOL } from '../../tool-names'
import { createSendMessageTool } from './send-message'
import { createTaskStopTool } from './task-stop'
import {
  agentPermissionResources,
  createAgentTool,
  type AgentRequest,
  type AgentToolPort,
} from './agent-tool'

function port() {
  const started: { toolCallId: string; request: AgentRequest }[] = []
  const value: AgentToolPort = {
    start: async (toolCallId, request) => {
      started.push({ toolCallId, request })
      return { content: 'started' }
    },
  }
  return { value, started }
}

/** A call as the model makes it: prepared, checked against the schema, then run. */
async function call(target: AgentToolPort, raw: Record<string, unknown>) {
  const tool = createAgentTool(target)
  const prepared = tool.prepareArguments ? tool.prepareArguments(raw) : raw
  const parsed = tool.inputSchema.safeParse(prepared)
  if (!parsed.success) return { content: 'invalid', isError: true, schemaError: true }
  return tool.execute('call-1', parsed.data as never, undefined, undefined, undefined)
}

describe('Agent', () => {
  test('is named as in Claude Code and takes its fields', () => {
    const tool = createAgentTool(port().value)
    expect(tool.name).toBe('Agent')
    const schema = tool.inputSchema.toJSONSchema() as { properties: object }
    const fields = Object.keys(schema.properties)
    expect(fields.sort()).toEqual([
      'description',
      'name',
      'prompt',
      'run_in_background',
      'subagent_type',
    ])
  })

  test('says how many run at once from the lanes’ own cap, not a number of its own', () => {
    const { description } = createAgentTool(port().value)
    expect(description).toContain(`Up to ${DELEGATION_SLOT_CAP} run at once`)
  })

  test('tells the parent what a subagent can and cannot do, from the exposure and the limit', () => {
    // LOCALIX-430: children were briefed to test tools they were blocked from, because only their
    // own prompt said so.
    const { description } = createAgentTool(port().value)
    expect(builtinToolExposure(TOOL.Agent)?.subagent).toBe('never')
    expect(builtinToolExposure(TOOL.TaskStop)?.subagent).toBe('never')
    expect(description).toContain('A subagent has no Agent or TaskStop')
    // Claude Code removes SendMessage from a subagent's inherited tools; only an agent file that
    // lists it has it, so the brief does not promise a message back.
    expect(builtinToolExposure(TOOL.SendMessage)?.subagent).toBe('opt-in')
    expect(description).not.toContain(`${TOOL.SendMessage} you`)
  })

  test('calls of one step overlap: starting, messaging and stopping do not queue behind each other', () => {
    // A barrier made three background launches 1.2 s apart and two synchronous subagents run one
    // after the other (LOCALIX-430). The lanes decide admission synchronously; no barrier is needed.
    const tools = [createAgentTool(port().value), createSendMessageTool({}), createTaskStopTool({})]
    expect(tools.map((tool) => tool.executionMode)).toEqual(['parallel', 'parallel', 'parallel'])
  })

  test('runs in the background unless the call asks to wait', async () => {
    const { value, started } = port()
    await call(value, { description: 'Check login', prompt: 'Verify the login flow' })
    await call(value, {
      description: 'Review',
      prompt: 'Review the diff',
      subagent_type: 'code-reviewer',
      run_in_background: false,
    })
    expect(started.map((entry) => entry.request)).toEqual([
      { task: 'Verify the login flow', title: 'Check login', context: 'none', wait: false },
      {
        task: 'Review the diff',
        title: 'Review',
        agent: 'code-reviewer',
        context: 'none',
        wait: true,
      },
    ])
  })

  test('subagent_type "fork" continues this conversation, in any case', async () => {
    const { value, started } = port()
    await call(value, { description: 'Audit', prompt: 'Audit auth', subagent_type: ' Fork ' })
    expect(started[0]!.request).toEqual({
      task: 'Audit auth',
      title: 'Audit',
      context: 'fork',
      wait: false,
    })
  })

  test('general-purpose runs the task as the calling agent itself', async () => {
    const { value, started } = port()
    await call(value, { description: 'Scan', prompt: 'Scan', subagent_type: 'general-purpose' })
    expect(started[0]!.request).toEqual({
      task: 'Scan',
      title: 'Scan',
      context: 'none',
      wait: false,
    })
  })

  test('a model, effort or worktree written into the call is not the call’s to choose', async () => {
    // The person sets each agent's model and effort; a call written for Claude Code still runs.
    const { value, started } = port()
    const result = await call(value, {
      description: 'Audit',
      prompt: 'Audit auth',
      subagent_type: 'Explore',
      model: 'opus',
      effort: 'max',
      isolation: 'worktree',
    })
    expect(result.isError).toBeUndefined()
    expect(started[0]!.request).toEqual({
      task: 'Audit auth',
      title: 'Audit',
      agent: 'Explore',
      context: 'none',
      wait: false,
    })
  })

  test('a model named in the call is dropped, even from a host', async () => {
    const { value, started } = port()
    const tool = createAgentTool(value)
    await tool.execute(
      'mod-1',
      { description: 'Spawned', prompt: 'Do it', model: 'haiku' } as never,
      undefined,
      undefined,
      undefined,
    )
    expect(started[0]!.request).not.toHaveProperty('model')
  })

  test('a name makes the subagent addressable by it, as in Claude Code', async () => {
    // SendMessage({to: name}) and TaskStop find a child by its title.
    const { value, started } = port()
    const result = await call(value, {
      description: 'Audit auth',
      prompt: 'Audit the auth module',
      subagent_type: 'Explore',
      name: 'auditor',
    })
    expect(result.isError).toBeUndefined()
    expect(started[0]!.request.title).toBe('auditor')
  })

  test('a start in the retired delegate spelling is refused, not guessed at', async () => {
    const { value, started } = port()
    const result = await call(value, { task: 'Verify', title: 'Check', agent: 'fork', wait: true })
    expect(result.isError).toBe(true)
    expect(started).toEqual([])
  })

  test('a call without a prompt is refused by the schema', async () => {
    const { value, started } = port()
    expect((await call(value, { description: 'x' })).isError).toBe(true)
    expect(started).toEqual([])
  })

  test('a permission rule names the agent the call starts', () => {
    expect(agentPermissionResources({ subagent_type: 'fork' })).toEqual(['fork'])
    expect(agentPermissionResources({ subagent_type: 'design' })).toEqual(['design'])
    expect(agentPermissionResources({})).toEqual([])
  })
})
