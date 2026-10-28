import { describe, expect, test } from 'bun:test'

import { mcpPromptCommands } from './useMcpPromptCommands'

describe('the composer rows of MCP prompts', () => {
  const [review, plain] = mcpPromptCommands([
    {
      server: 'github',
      name: 'code-review',
      fullName: 'mcp__github__code-review',
      description: 'Review code',
      args: [
        { name: 'file', description: 'The file', required: true },
        { name: 'focus', description: '', required: false },
      ],
    },
    { server: 'github', name: 'plain', fullName: 'mcp__github__plain', description: '', args: [] },
  ])

  test('each is a command typed as /mcp__<server>__<prompt>, described by its prompt', () => {
    expect(review).toMatchObject({
      id: 'mcp-prompt:mcp__github__code-review',
      trigger: 'mcp__github__code-review',
      prefix: '/mcp__github__code-review ',
      description: 'Review code',
    })
    expect(plain?.description).toBe('From the github MCP server')
  })

  test('the arguments it declares are one free-text slot that names them, required ones in <>', () => {
    expect(review?.args).toEqual([
      { name: 'arguments', type: 'text', placeholder: '<file> [focus]' },
    ])
    expect(plain?.args).toBeUndefined()
  })
})
