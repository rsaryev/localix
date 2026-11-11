import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { loadManifest } from '../plugins/manifest-load'
import { pluginMcpRecords } from '../plugins/testing/test-mcp-records'
import { claudeCodeMcp } from './claude-code-settings'
import { withClaudeCodeMcp } from './testing/claude-code-host'

withClaudeCodeMcp()

/**
 * A plugin's remote server may carry a `headersHelper` (plugins reference, "MCP servers"): enabling
 * the plugin is the person's consent, as for its stdio servers. The helper starts in the plugin's
 * directory with `CLAUDE_PLUGIN_ROOT` set, and `${CLAUDE_PLUGIN_ROOT}` in its command resolves.
 */
const dir = tempDirPerTest('plugin-headers-helper-')

describe("a plugin's headersHelper", () => {
  test('runs from the plugin directory and is told where it is', async () => {
    const root = join(dir(), 'plugin')
    writeTree(root, {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'p' }),
      '.mcp.json': JSON.stringify({
        mcpServers: {
          api: { type: 'http', url: 'https://x.example/mcp', headersHelper: 'sh ./bin/auth.sh' },
        },
      }),
      'bin/auth.sh': `#!/bin/sh\nprintf '{"X-Root":"%s"}' "$CLAUDE_PLUGIN_ROOT"\n`,
    })
    const plugin = await loadManifest(root, 'global', '')
    const [record] = await pluginMcpRecords(plugin, {}, dir())
    expect(record?.id).toBe('plugin:p:api')
    if (!record) throw new Error('no record')
    const remote = await claudeCodeMcp().remoteRequest(record, record.config, dir(), fetch)
    expect(remote.requestInit?.headers).toMatchObject({ 'X-Root': root })
  })
})
