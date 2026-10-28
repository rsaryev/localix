import { describe, expect, test } from 'bun:test'

import { mcpPromptSpecs } from './mcp-prompt-specs'

describe('mcpPromptSpecs', () => {
  test('lists each prompt as the slash command that runs it', () => {
    expect(
      mcpPromptSpecs([
        {
          server: 'my server',
          serverId: 's1',
          prompt: {
            name: 'code-review',
            description: 'Review code',
            arguments: [
              { name: 'file', description: 'The file', required: true },
              { name: 'focus' },
            ],
          },
        },
        { server: 'github', serverId: 's2', prompt: { name: 'plain' } },
      ]),
    ).toEqual([
      {
        server: 'my server',
        name: 'code-review',
        fullName: 'mcp__my_server__code-review',
        description: 'Review code',
        args: [
          { name: 'file', description: 'The file', required: true },
          { name: 'focus', description: '', required: false },
        ],
      },
      {
        server: 'github',
        name: 'plain',
        fullName: 'mcp__github__plain',
        description: '',
        args: [],
      },
    ])
  })
})
