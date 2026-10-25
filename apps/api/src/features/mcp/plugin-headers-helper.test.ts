import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { buildMcpRecords } from '../plugins/mcp'
import { helperRequestHeaders } from './headers-helper'

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
      'bin/auth.sh': `#!/bin/sh\nprintf '{"X-Root":"%s"}' "$CLAUDE_PLUGIN_ROOT"\n`,
    })
    const [record] = buildMcpRecords(
      {
        dir: root,
        projectId: null,
        manifest: { name: 'p', config: {} },
        entrypoints: {
          mcpServers: {
            api: { type: 'http', url: 'https://x.example/mcp', headersHelper: 'sh ./bin/auth.sh' },
          },
        },
      } as never,
      {},
      'u',
      'ts',
      dir(),
    )
    expect(record?.id).toBe('plugin:p:api')
    const got = await helperRequestHeaders(record!, record!.config, dir(), {
      env: { PATH: process.env.PATH },
    })
    expect(got.headers['X-Root']).toBe(root)
  })
})
