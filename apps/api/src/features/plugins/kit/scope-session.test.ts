import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { readPluginFolder } from './catalog/read-folder'
import { diskPluginHost } from './testing'
import { scopeMcpServers } from './scope-session'
import type { ScopePlugin } from './sessions'

const dir = tempDirPerTest('kit-mcp-servers')

async function installed(
  name: string,
  over: Partial<ScopePlugin> = {},
  server: Record<string, unknown> = {
    command: '${CLAUDE_PLUGIN_ROOT}/bin/serve',
    args: ['--token=${user_config.token}', '--in=${CLAUDE_PROJECT_DIR}'],
  },
): Promise<ScopePlugin> {
  const root = join(dir(), over.scope === 'project' ? 'work/.localix/plugins' : 'plugins', name)
  writeTree(root, {
    '.claude-plugin/plugin.json': JSON.stringify({
      name,
      userConfig: { token: { type: 'string', title: 'Token', description: 'API token' } },
    }),
    '.mcp.json': JSON.stringify({ mcpServers: { api: server } }),
  })
  const plugin = (await readPluginFolder(root)).kit
  if (!plugin) throw new Error('fixture does not load')
  return { id: name, root, plugin, selected: true, scope: 'user', values: {}, ...over }
}

const scope = (plugins: readonly ScopePlugin[]) => ({
  cwd: join(dir(), 'work'),
  homeDir: dir(),
  plugins,
})

describe("a scope's plugin MCP servers, as the kit resolves them", () => {
  test("a selected plugin's server, its values and path variables substituted", async () => {
    const host = diskPluginHost(dir())
    const fmt = await installed('fmt', { values: { token: 's3cr3t' } })
    const { resolved } = await scopeMcpServers(host, scope([fmt]))
    expect(resolved.map(({ key, server }) => [key, server])).toEqual([
      [
        'plugin:fmt:api',
        {
          command: join(fmt.root, 'bin/serve'),
          args: ['--token=s3cr3t', `--in=${join(dir(), 'work')}`],
        },
      ],
    ])
  })

  test("a project's own plugin resolves from its folder, an unselected one not at all", async () => {
    const host = diskPluginHost(dir())
    const lint = await installed('lint', { scope: 'project', values: { token: 't' } })
    const off = await installed('off', { selected: false })
    const { resolved } = await scopeMcpServers(host, scope([lint, off]))
    expect(
      resolved.map(({ key, server }) => [key, (server as { command?: string }).command]),
    ).toEqual([['plugin:lint:api', join(lint.root, 'bin/serve')]])
  })
})
