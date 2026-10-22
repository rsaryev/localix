/** Session E2E: Claude Code plugin MCP servers — /mcp, a server that fails, disabling, and an http server. */
import assert from 'node:assert/strict'

import {
  STDIO_SERVER,
  alive,
  brokenServerRow,
  configure,
  events,
  offer,
  offerAndCall,
  serverLog,
  stdio,
  until,
  withBrokenPlugin,
  withPlugin,
} from './scenarios-cc-mcp-helpers.mjs'

export const CC_MCP_STATUS_SCENARIOS = [
  {
    name: 'cc-mcp: /mcp lists a plugin’s servers as plugin:<plugin>:<server> and marks one that fails to start',
    async run(rt) {
      await withBrokenPlugin(rt, async (session) => {
        const listed = await rt.say(session.id, '/mcp')
        const reply = rt.transcript(listed).at(-1).text
        // "Load the plugin and run `/mcp` to confirm the server appears as `plugin:my-plugin:db`."
        assert.ok(reply.includes('plugin:brokenkit:echo'), `the working server: ${reply}`)
        // "A server with bad credentials shows an ✘ instead" in `/mcp`; "`claude mcp list` shows
        // a health status ... `✘ Failed to connect`" (mcp.md). Either marker is Claude Code's.
        const line = reply.split('\n').find((row) => row.includes('plugin:brokenkit:broken'))
        assert.ok(line && /✘|fail/i.test(line), `the failed server is marked: ${reply}`)
        const ok = reply.split('\n').find((row) => row.includes('plugin:brokenkit:echo'))
        assert.ok(!/✘|fail/i.test(ok), `the working server is not marked failed: ${ok}`)
      })
    },
  },
  {
    name: 'cc-mcp: a plugin server that fails to start is named to the model with its error, and its sibling still works',
    async run(rt) {
      await withBrokenPlugin(rt, async (session, log) => {
        const { read } = await offerAndCall(rt, session, 'brokenkit', 'echo', { text: 'ok' })
        assert.ok(read.includes('stdio:echo:ok'), `the sibling server works: ${read}`)
        assert.equal(events(log).filter((e) => e.event === 'call').length, 1)
        // "With tool search, Claude Code tells Claude which server failed and its connection
        // error, so Claude reports the connection failure in its response." (mcp.md)
        const line = brokenServerRow(rt, session)
        // The broken server by its own name (not the plugin's or the sibling's), as failed, with
        // the error its connection ended on: node exits on the missing script, closing stdio.
        assert.ok(
          line && /fail/i.test(line) && /connection closed/i.test(line),
          `the model was told the server failed and why: ${line}`,
        )
      })
    },
  },
  {
    name: 'cc-mcp: disabling the plugin removes its MCP tool and stops its server',
    async run(rt) {
      const log = serverLog(rt, 'stop')
      const files = {
        'server.mjs': STDIO_SERVER,
        '.mcp.json': { mcpServers: { echo: stdio(log) } },
      }
      await withPlugin(rt, 'stopkit', files, async () => {
        const session = await rt.createSession({ title: 'MCP disable' })
        await offerAndCall(rt, session, 'stopkit', 'echo', { text: 'ping' })
        const { pid } = events(log).find((e) => e.event === 'start')
        assert.ok(alive(pid), 'the server runs while the plugin is enabled')
        // "If you enable or disable a plugin during a session, Claude Code connects or
        // disconnects its MCP servers when the change applies." (mcp.md)
        const disabled = await rt.say(session.id, '/plugin disable stopkit')
        assert.match(rt.transcript(disabled).at(-1).text, /Disabled `stopkit`/)
        assert.equal(await offer(rt, session, 'stopkit', 'echo'), undefined, 'the tool is gone')
        await until(() => !alive(pid), `the server ${pid} exits`)
      })
    },
  },
  {
    name: 'cc-mcp: an http plugin server is reached at a user_config url with user_config headers, and its result reaches the model',
    async run(rt) {
      const seen = []
      const result = (msg) => {
        if (msg.method === 'initialize')
          return {
            protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'e2e-http', version: '1.0.0' },
          }
        if (msg.method === 'tools/list')
          return {
            tools: [
              {
                name: 'echo',
                description: 'Echo the text back',
                annotations: { readOnlyHint: true },
                inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
              },
            ],
          }
        if (msg.method === 'tools/call')
          return { content: [{ type: 'text', text: `http:echo:${msg.params.arguments?.text}` }] }
        return {}
      }
      // Streamable HTTP, minimal: every POST answered with one JSON body; no SSE stream (405).
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          if (request.method !== 'POST') return new Response(null, { status: 405 })
          const msg = await request.json()
          seen.push({ headers: Object.fromEntries(request.headers), msg })
          if (msg.id === undefined) return new Response(null, { status: 202 })
          return Response.json({ jsonrpc: '2.0', id: msg.id, result: result(msg) })
        },
      })
      try {
        const files = {
          '.claude-plugin/plugin.json': {
            name: 'httpkit',
            version: '1.0.0',
            userConfig: {
              endpoint: { type: 'string', title: 'Endpoint', description: 'Server URL' },
              api_token: { type: 'string', title: 'Token', description: 'Auth', sensitive: true },
            },
            // "| MCP `http`, `sse`, `ws` servers | `url`, `headers`, `headersHelper` |" are the
            // fields where `${...}` resolves; "Put `${user_config.KEY}` in the server's
            // `headers` field instead, which isn't shell-parsed" (mcp.md)
            mcpServers: {
              api: {
                type: 'http',
                url: '${user_config.endpoint}',
                headers: { Authorization: 'Bearer ${user_config.api_token}', 'X-E2E': 'yes' },
              },
            },
          },
        }
        await withPlugin(rt, 'httpkit', files, async () => {
          const session = await rt.createSession({ title: 'MCP http' })
          await configure(rt, session, 'httpkit', {
            endpoint: `http://127.0.0.1:${server.port}/mcp`,
            api_token: 'tok-HTTP-1',
          })
          const { read } = await offerAndCall(rt, session, 'httpkit', 'api', { text: 'ping' })
          assert.ok(read.includes('http:echo:ping'), `the model read the http result: ${read}`)
          const call = seen.find((entry) => entry.msg.method === 'tools/call')
          assert.ok(call, `the server received the call: ${JSON.stringify(seen.map((s) => s.msg))}`)
          assert.equal(call.headers.authorization, 'Bearer tok-HTTP-1')
          assert.equal(call.headers['x-e2e'], 'yes')
        })
      } finally {
        server.stop(true)
      }
    },
  },
]
