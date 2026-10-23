/** Session E2E: Claude Code plugin MCP servers — stdio servers, tool names, variables and userConfig. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  STDIO_SERVER,
  callTool,
  configure,
  events,
  offer,
  offerAndCall,
  serverLog,
  stdio,
  withPlugin,
} from './scenarios-cc-mcp-helpers.mjs'

export const CC_MCP_SERVER_SCENARIOS = [
  {
    name: 'cc-mcp: a .mcp.json stdio server’s tool is offered and a call returns the server’s result, with plugin paths substituted',
    async run(rt) {
      const log = serverLog(rt, 'basic')
      // "Declare it in `.mcp.json` at the plugin root" (plugins/components.md); "Substitution:
      // `${CLAUDE_PLUGIN_ROOT}` and the other path variables are substituted in `command`,
      // `args`, and `env`" (ibid.).
      const files = {
        'server.mjs': STDIO_SERVER,
        '.mcp.json': {
          mcpServers: {
            echo: stdio(log, {
              args: ['--data', '${CLAUDE_PLUGIN_DATA}'],
              env: { E2E_TAG: 'kit', E2E_DATA: '${CLAUDE_PLUGIN_DATA}' },
            }),
          },
        },
      }
      await withPlugin(rt, 'mcpkit', files, async (record) => {
        const session = await rt.createSession({ title: 'MCP basic' })
        const { read } = await offerAndCall(rt, session, 'mcpkit', 'echo', { text: 'ping' })
        assert.ok(read.includes('kit:echo:ping'), `the model read the server's result: ${read}`)
        const start = events(log).find((e) => e.event === 'start')
        assert.equal(start.argv[0], path.join(record.dir, 'server.mjs'), 'CLAUDE_PLUGIN_ROOT')
        const data = start.argv[2]
        assert.ok(path.isAbsolute(data) && !data.includes('${'), `CLAUDE_PLUGIN_DATA: ${data}`)
        // "`${CLAUDE_PLUGIN_DATA}` ... is created when first referenced" (plugins/components.md);
        // this config references it in `args` and `env`.
        assert.ok(existsSync(data), `the referenced data dir exists: ${data}`)
        assert.equal(start.env.E2E_DATA, data, 'the same data dir substitutes in env')
        const calls = events(log).filter((e) => e.event === 'call')
        assert.deepEqual(calls, [{ event: 'call', name: 'echo', arguments: { text: 'ping' } }])
      })
    },
  },
  {
    name: 'cc-mcp: a plugin MCP tool reaches the model as mcp__plugin_<plugin>_<server>__<tool>',
    async run(rt) {
      const log = serverLog(rt, 'naming')
      const files = { 'server.mjs': STDIO_SERVER, '.mcp.json': { mcpServers: { db: stdio(log) } } }
      await withPlugin(rt, 'namekit', files, async () => {
        const session = await rt.createSession({ title: 'MCP naming' })
        // "For the `database-tools` server bundled in a plugin named `my-plugin`, a `query` tool
        // is callable as: mcp__plugin_my-plugin_database-tools__query" (mcp.md)
        const name = await offer(rt, session, 'namekit', 'db')
        assert.equal(name, 'mcp__plugin_namekit_db__echo')
        const read = await callTool(rt, session, name, { text: 'named' })
        assert.ok(read.includes('echo:named'), `the call by that name ran: ${read}`)
        // The transcript keeps Localix's own name: it is the tool's identity for rules and grants.
        const stored = JSON.stringify((await rt.detail(session.id)).messages)
        const item = (tool) => new RegExp(`\\\\?"name\\\\?":\\\\?"${tool}\\\\?"`)
        assert.match(stored, item('mcp_namekit_db_echo'), 'the call is stored under the own name')
        assert.doesNotMatch(stored, item('mcp__plugin_namekit_db__echo'), 'not the model name')
      })
    },
  },
  {
    name: 'cc-mcp: a stored deny on the tool’s own name still refuses a call made by its Claude Code name',
    async run(rt) {
      const log = serverLog(rt, 'naming-deny')
      const files = { 'server.mjs': STDIO_SERVER, '.mcp.json': { mcpServers: { db: stdio(log) } } }
      const scope = { agentId: rt.agentIds.localix }
      // A class, not `*`: the tool stays on offer and the gate is what refuses the call (the echo
      // tool declares `readOnlyHint`, so its calls are `effect:read`).
      const deny = { action: 'tool:mcp_denykit_db_echo', resource: 'effect:read', effect: 'deny' }
      // Re-read before each write: installing the plugin writes the same scope in between.
      const update = async (change) => {
        const now = await rt.api(`/capabilities/rules?agentId=${encodeURIComponent(scope.agentId)}`)
        const body = { ...scope, rules: change(now.rules), expectedRevision: now.revision }
        await rt.api('/capabilities/rules', body, 'PUT')
      }
      await update((rules) => [...rules, deny])
      try {
        await withPlugin(rt, 'denykit', files, async () => {
          const session = await rt.createSession({ title: 'MCP naming deny' })
          const name = await offer(rt, session, 'denykit', 'db')
          assert.equal(name, 'mcp__plugin_denykit_db__echo', 'the tool is offered, not withheld')
          const read = await callTool(rt, session, name, { text: 'refused' })
          assert.ok(!read.includes('echo:refused'), `the denied call ran: ${read}`)
          assert.ok(!/not found/i.test(read), `the call was refused, not lost: ${read}`)
          assert.match(read, /Blocked: \S+ is not permitted here/, `the rule refused it: ${read}`)
          const calls = events(log).filter((e) => e.event === 'call')
          assert.deepEqual(calls, [], 'the server never received the call')
        })
      } finally {
        await update((rules) =>
          rules.filter((rule) => rule.action !== deny.action || rule.resource !== deny.resource),
        )
      }
    },
  },
  {
    name: 'cc-mcp: a stdio server’s environment carries CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA',
    async run(rt) {
      const log = serverLog(rt, 'env')
      const files = { 'server.mjs': STDIO_SERVER, '.mcp.json': { envsrv: stdio(log) } }
      await withPlugin(rt, 'envkit', files, async (record) => {
        const session = await rt.createSession({ title: 'MCP env' })
        await offerAndCall(rt, session, 'envkit', 'envsrv', { text: 'env' })
        const start = events(log).find((e) => e.event === 'start')
        assert.ok(start, 'the server started')
        // "| MCP `stdio` servers | `command`, `args`, `env` | `CLAUDE_PLUGIN_ROOT`,
        // `CLAUDE_PLUGIN_DATA` |" — the last column is "Exported to the process" (manifest ref).
        assert.equal(start.env.CLAUDE_PLUGIN_ROOT, record.dir)
        const data = start.env.CLAUDE_PLUGIN_DATA
        assert.ok(data && path.isAbsolute(data), `CLAUDE_PLUGIN_DATA exported: ${data}`)
        // Whether exporting counts as the "first reference" that creates the directory is not
        // documented, so its existence is asserted only where the config references it (above).
      })
    },
  },
  {
    name: 'cc-mcp: plugin.json mcpServers (a .json file and an inline map) loads beside .mcp.json, replaces a same-named server, and substitutes user_config',
    async run(rt) {
      const [dotLog, manifestLog, fileLog] = ['dot', 'manifest', 'file'].map((n) =>
        serverLog(rt, `cfg-${n}`),
      )
      const files = {
        'server.mjs': STDIO_SERVER,
        // "You can also omit the `mcpServers` wrapper and put `db` at the top level of the file."
        '.mcp.json': { echo: stdio(dotLog, { env: { E2E_TAG: 'dotmcp' } }) },
        'mcp/extra.json': { mcpServers: { second: stdio(fileLog, { env: { E2E_TAG: 'file' } }) } },
        '.claude-plugin/plugin.json': {
          name: 'cfgkit',
          version: '1.0.0',
          userConfig: {
            region: { type: 'string', title: 'Region', description: 'Where to run' },
            api_token: { type: 'string', title: 'Token', description: 'Auth', sensitive: true },
          },
          // "Claude Code loads `.mcp.json` at the plugin root first, then each declared shape in
          // order. A server name declared later replaces an earlier one." (manifest reference)
          mcpServers: [
            './mcp/extra.json',
            {
              echo: stdio(manifestLog, {
                args: ['--region', '${user_config.region}'],
                // "`${user_config.KEY}`: substituted in MCP server config" — sensitive included.
                env: { E2E_TAG: '${user_config.region}', E2E_TOKEN: '${user_config.api_token}' },
              }),
            },
          ],
        },
      }
      await withPlugin(rt, 'cfgkit', files, async () => {
        const session = await rt.createSession({ title: 'MCP manifest' })
        await configure(rt, session, 'cfgkit', { region: 'eu-west', api_token: 'tok-SECRET-1' })
        const { read } = await offerAndCall(rt, session, 'cfgkit', 'echo', { text: 'ping' })
        assert.ok(read.includes('eu-west:echo:ping'), `the manifest's server answered: ${read}`)
        const start = events(manifestLog).find((e) => e.event === 'start')
        assert.deepEqual(start.argv.slice(1), ['--region', 'eu-west'])
        assert.equal(start.env.E2E_TOKEN, 'tok-SECRET-1', 'a sensitive value substitutes in env')
        assert.equal(events(dotLog).length, 0, 'the replaced .mcp.json server never started')
        const second = await offerAndCall(rt, session, 'cfgkit', 'second', { text: 'two' })
        assert.ok(second.read.includes('file:echo:two'), `the .json file's server: ${second.read}`)
      })
    },
  },
  {
    name: 'cc-mcp: a user_config value saved for the user reaches the plugin’s MCP server in a chat of any project',
    async run(rt) {
      const log = serverLog(rt, 'global-cfg')
      const files = {
        'server.mjs': STDIO_SERVER,
        '.claude-plugin/plugin.json': {
          name: 'globalcfg',
          version: '1.0.0',
          userConfig: { region: { type: 'string', title: 'Region', description: 'Where' } },
        },
        '.mcp.json': { mcpServers: { echo: stdio(log, { args: ['${user_config.region}'] }) } },
      }
      await withPlugin(rt, 'globalcfg', files, async () => {
        // "Non-sensitive values are saved under `pluginConfigs` in the user's `settings.json`"
        // (manifest reference): one value for the user, not one per project.
        await rt.api('/plugins/config', { name: 'globalcfg', values: { region: 'eu-north' } })
        const session = await rt.createSession({ title: 'MCP global config' })
        await offerAndCall(rt, session, 'globalcfg', 'echo', { text: 'ping' })
        const start = events(log).find((e) => e.event === 'start')
        assert.deepEqual(start?.argv.slice(1), ['eu-north'])
      })
    },
  },
]
