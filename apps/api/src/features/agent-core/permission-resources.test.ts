import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'
import { z } from 'zod'
import { createPermissionGate, evaluate, extractCallFacts } from './permission-engine'

const tool: AgentTool = {
  name: 'records',
  description: 'Test resource policy',
  activeVerb: 'Checking records',
  inputSchema: z.object({}),
  execute: async () => ({ content: 'unused' }),
  permissionResources: () => ['record:one', 'record:two'],
}

describe('native tool permission resources', () => {
  test('live approval identifies the resources being approved', async () => {
    const requests: string[] = []
    const gate = createPermissionGate({
      rules: [{ permission: 'records', pattern: 'record:one', action: 'ask' }],
      toolsByName: new Map([[tool.name, tool]]),
      requestConfirm: async ({ command }) => {
        requests.push(command ?? '')
        return { approved: false }
      },
    })
    expect(await gate({ toolCallId: 'call', toolName: tool.name, input: {} })).toMatchObject({
      block: true,
      refusal: 'human',
    })
    expect(requests).toEqual(['record:one\nrecord:two'])
  })

  test('allow must cover all declared resources; deny or ask needs only one', () => {
    const call = extractCallFacts(tool.name, {}, undefined, tool)
    const facts = { name: tool.name, effect: 'read' as const }
    for (const action of ['deny', 'ask'] as const) {
      expect(
        evaluate([{ permission: 'records', pattern: 'record:two', action }], facts, call).action,
      ).toBe(action)
    }
    expect(
      evaluate(
        [
          { permission: 'records', pattern: '*', action: 'deny' },
          { permission: 'records', pattern: 'record:one', action: 'allow' },
        ],
        facts,
        call,
      ).action,
    ).toBe('deny')
    expect(
      evaluate(
        [
          { permission: 'records', pattern: '*', action: 'deny' },
          { permission: 'records', pattern: 'record:*', action: 'allow' },
        ],
        facts,
        call,
      ).action,
    ).toBe('allow')
  })

  test('native resources do not replace filesystem or command facts', () => {
    const file = extractCallFacts('Read', { path: '/tmp/project/a' }, '/tmp/project', tool)
    expect(file.paths).toEqual(['/tmp/project/a'])
    expect(file.resources).toEqual(['record:one', 'record:two'])
    const shell = extractCallFacts('Bash', { command: 'git status' }, '/tmp/project', tool)
    expect(shell.commands).toEqual(['git status'])
    expect(shell.resources).toEqual(['record:one', 'record:two'])
    expect(
      evaluate(
        [
          { permission: 'Bash', pattern: '*', action: 'deny' },
          { permission: 'Bash', pattern: 'git *', action: 'allow' },
        ],
        { name: 'Bash', effect: 'external' },
        shell,
      ).action,
    ).toBe('deny')
  })

  test.each([undefined, null, 'record:one', [42], [''], Array(1)].map((value) => ({ value })))(
    'invalid declaration %j fails before permission can be granted',
    async ({ value }) => {
      const invalid = { ...tool, permissionResources: () => value as never }
      const gate = createPermissionGate({
        // Even a list that allows everything: the declaration is checked before any rule.
        rules: [{ permission: '*', pattern: '*', action: 'allow' }],
        toolsByName: new Map([[tool.name, invalid]]),
      })
      await expect(gate({ toolCallId: 'call', toolName: tool.name, input: {} })).rejects.toThrow(
        'Invalid permission resources',
      )
    },
  )

  test('a throwing resource resolver cannot fall back to unrestricted facts', () => {
    expect(() =>
      extractCallFacts('records', {}, undefined, {
        permissionResources: () => {
          throw new Error('Cannot resolve resources')
        },
      }),
    ).toThrow('Cannot resolve resources')
  })
})
