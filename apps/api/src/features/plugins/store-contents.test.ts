import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { scanPluginContents } from './store-contents'

const dir = tempDirPerTest('plugin-store-contents-')

describe('what a plugin folder adds and runs, read without installing it', () => {
  test('its skills, commands, agents, hooks, mod, servers, styles and bin', async () => {
    writeTree(dir(), {
      'review/.claude-plugin/plugin.json': JSON.stringify({ name: 'review', version: '1.0.0' }),
      'review/skills/review-pr/SKILL.md': '---\nname: review-pr\ndescription: Review a PR\n---\nGo',
      'review/commands/review.md': '---\ndescription: Review now\n---\nReview',
      'review/agents/critic.md': '---\nname: critic\ndescription: Finds faults\n---\nBe harsh',
      'review/hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'lint.sh' }] }],
        },
      }),
      'review/.mcp.json': JSON.stringify({
        mcpServers: {
          local: { command: 'node', args: ['server.js'] },
          remote: { type: 'http', url: 'https://api.acme.test/mcp' },
        },
      }),
      'review/bin/review-cli': '#!/bin/sh',
    })
    const found = await scanPluginContents(join(dir(), 'review'), 'review@acme')
    expect(found.components.map((part) => `${part.kind}:${part.name}`).sort()).toEqual(
      [
        'agent:critic',
        'command:/review:review',
        'hook:PostToolUse',
        'mcp-server:local',
        'mcp-server:remote',
        'skill:review-pr',
      ].sort(),
    )
    expect(found.runs).toEqual(
      expect.arrayContaining([
        { kind: 'hook', name: 'PostToolUse', command: 'lint.sh' },
        { kind: 'mcp-server', name: 'local', command: 'node server.js' },
        { kind: 'command', name: 'bin/', command: 'review-cli' },
      ]),
    )
    expect(found.network).toEqual(['api.acme.test'])
  })

  test('a text-only plugin runs nothing', async () => {
    writeTree(dir(), {
      'words/.claude-plugin/plugin.json': JSON.stringify({ name: 'words' }),
      'words/skills/write/SKILL.md': '---\nname: write\ndescription: Write well\n---\nWrite',
    })
    const found = await scanPluginContents(join(dir(), 'words'), 'words@acme')
    expect(found.components).toEqual([{ kind: 'skill', name: 'write' }])
    expect(found.runs).toEqual([])
  })
})
