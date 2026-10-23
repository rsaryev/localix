/** Session E2E: Claude Code plugin agents — a `tools` list is the subagent's exact allowlist. */
import assert from 'node:assert/strict'

import { until } from './scenarios-cc-helpers.mjs'
import {
  agentPlugin,
  childOf,
  delegateStep,
  delegateTurn,
  heard,
  hookLog,
  mcpServer,
  withPlugins,
} from './scenarios-cc-agents-helpers.mjs'

/** What every run's compressed output points at (`tool_output`), the one tool beside the list. */
const RECOVERY = 'tool_output'

export const CC_AGENT_TOOL_SCENARIOS = [
  {
    name: 'cc-agents: a tools list is exact — the subagent holds only those tools, no host or MCP extras',
    async run(rt) {
      const files = {
        ...agentPlugin('reader', ['tools: Read'], 'EXACT-READER body.'),
        '.mcp.json': JSON.stringify({ mcpServers: { ctl: mcpServer(rt, 'ag-exact') } }),
      }
      await withPlugins(rt, { 'e2e-ag-exact': files }, async () => {
        const { children } = await delegateTurn(rt, 'Agent exact tools', [
          delegateStep('e2e-ag-exact:reader', ['EXACT-OK']),
          'Reported.',
        ])
        // sub-agents.md: "`tools` | No | Tools the subagent can use"; a subagent restricted to
        // `Read, Grep, Glob, Bash` "can't edit files, write files, or use any MCP tools".
        for (const run of childOf(children, 'EXACT-READER body.'))
          assert.deepEqual(
            [...run.tools].sort(),
            ['read', RECOVERY],
            `the child held more than its list: ${run.tools}`,
          )
      })
    },
  },
  {
    name: 'cc-agents: a tools list naming a plugin MCP tool by its Claude Code address gives the subagent that tool',
    async run(rt) {
      const plugin = 'e2e-ag-mcpx'
      const files = {
        ...agentPlugin(
          'caller',
          [`tools: Read, mcp__plugin_${plugin}_ctl__echo`],
          'MCPX-CALLER body.',
        ),
        '.mcp.json': JSON.stringify({ mcpServers: { ctl: mcpServer(rt, 'ag-mcpx') } }),
      }
      await withPlugins(rt, { [plugin]: files }, async () => {
        // The model is offered (and calls) the tool under Claude Code's name for it.
        const echo = `mcp__plugin_${plugin}_ctl__echo`
        const { children } = await delegateTurn(rt, 'Agent MCP allowlist', [
          delegateStep(`${plugin}:caller`, [
            { tool: echo, args: { text: 'MCPX-PING' } },
            'MCPX-OK',
          ]),
          'Reported.',
        ])
        await until(() => hookLog(rt, 'ag-mcpx').length > 0, 'the plugin MCP server started')
        // sub-agents.md: "`mcp__<server>__<tool>` in `tools`" names one MCP tool; the plugin's
        // server is addressed `plugin_<plugin>_<server>`.
        const runs = childOf(children, 'MCPX-CALLER body.')
        assert.deepEqual(
          [...runs[0].tools].sort(),
          [echo, 'read', RECOVERY],
          `the child's tools: ${runs[0].tools}`,
        )
        assert.ok(
          heard(runs.at(-1)).includes('echo:MCPX-PING'),
          'the child called the MCP tool and read its result',
        )
      })
    },
  },
]
