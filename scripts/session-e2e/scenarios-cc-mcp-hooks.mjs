/** Session E2E: Claude Code plugin MCP servers — tool hooks on MCP calls. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  STDIO_SERVER,
  callTool,
  command,
  events,
  hooksJson,
  offer,
  offerAndCall,
  serverLog,
  stdio,
  withPlugin,
} from './scenarios-cc-mcp-helpers.mjs'

export const CC_MCP_HOOK_SCENARIOS = [
  {
    name: 'cc-mcp: PreToolUse on mcp__plugin_<plugin>_<server>__.* denies a call before the server runs, or rewrites its input',
    async run(rt) {
      const log = serverLog(rt, 'guard')
      // "permissionDecision: "deny" prevents the tool call"; "updatedInput: Modifies the tool's
      // input parameters before execution. ... Combine with "allow" to auto-approve" (hooks.md)
      const guard = [
        'import json, sys',
        'call = json.load(sys.stdin)',
        'text = (call.get("tool_input") or {}).get("text", "")',
        'out = {"hookEventName": "PreToolUse"}',
        'if "forbidden" in text:',
        '    out.update(permissionDecision="deny", permissionDecisionReason="MCP-GUARD refused it")',
        'else:',
        '    out.update(permissionDecision="allow", updatedInput={"text": text.upper()})',
        'print(json.dumps({"hookSpecificOutput": out}))',
      ].join('\n')
      const files = {
        'server.mjs': STDIO_SERVER,
        '.mcp.json': { mcpServers: { echo: stdio(log) } },
        'hooks/guard.py': guard,
        // "the matcher for every tool from that server is `mcp__plugin_my-plugin_db__.*`"
        'hooks/hooks.json': hooksJson({
          PreToolUse: [
            {
              matcher: 'mcp__plugin_guardkit_echo__.*',
              hooks: [command('python3 "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py"')],
            },
          ],
        }),
      }
      await withPlugin(rt, 'guardkit', files, async () => {
        const session = await rt.createSession({ title: 'MCP PreToolUse' })
        const name = await offer(rt, session, 'guardkit', 'echo')
        assert.ok(name, 'the tool reached the model')
        const denied = await callTool(rt, session, name, { text: 'forbidden thing' })
        assert.ok(denied.includes('MCP-GUARD refused it'), `the model read the denial: ${denied}`)
        assert.equal(events(log).filter((e) => e.event === 'call').length, 0, 'no call reached')
        const rewritten = await callTool(rt, session, name, { text: 'quiet' })
        assert.ok(rewritten.includes('stdio:echo:QUIET'), `the rewrite ran: ${rewritten}`)
        const calls = events(log).filter((e) => e.event === 'call')
        assert.deepEqual(calls.at(-1)?.arguments, { text: 'QUIET' }, 'the server got the rewrite')
      })
    },
  },
  {
    name: 'cc-mcp: Pre/PostToolUse hooks read an MCP call as Claude Code shapes it: tool_name, tool_input, tool_response and mcp_server',
    async run(rt) {
      const log = serverLog(rt, 'shape')
      const pre = path.join(rt.root, 'cc-mcp-shape-pre.json')
      const post = path.join(rt.root, 'cc-mcp-shape-post.json')
      const files = {
        'server.mjs': STDIO_SERVER,
        '.mcp.json': { mcpServers: { echo: stdio(log) } },
        'hooks/hooks.json': hooksJson({
          PreToolUse: [
            { matcher: 'mcp__plugin_shapekit_echo__.*', hooks: [command(`cat > "${pre}"`)] },
          ],
          PostToolUse: [
            { matcher: 'mcp__plugin_shapekit_echo__.*', hooks: [command(`cat > "${post}"`)] },
          ],
        }),
      }
      await withPlugin(rt, 'shapekit', files, async () => {
        const session = await rt.createSession({ title: 'MCP hook input' })
        await offerAndCall(rt, session, 'shapekit', 'echo', { text: 'ping' })
        assert.ok(existsSync(pre) && existsSync(post), 'both hooks fired')
        const before = JSON.parse(readFileSync(pre, 'utf8'))
        const after = JSON.parse(readFileSync(post, 'utf8'))
        assert.equal(before.hook_event_name, 'PreToolUse')
        assert.deepEqual(before.tool_input, { text: 'ping' })
        // "For an MCP tool, the input also carries the `mcp_server` object" (PostToolUse input)
        assert.ok(JSON.stringify(after.tool_response).includes('stdio:echo:ping'), 'tool_response')
        // "a `query` tool on that `db` server is `mcp__plugin_my-plugin_db__query`. That is the
        // name to use in permission rules and hook matchers" (plugins/components.md)
        assert.equal(before.tool_name, 'mcp__plugin_shapekit_echo__echo')
        assert.equal(after.tool_name, 'mcp__plugin_shapekit_echo__echo')
        // "the input also carries `mcp_server`, an object with the server's `name` and a
        // `source` ... The `source` values include `plugin`" (PreToolUse input)
        assert.equal(before.mcp_server?.source, 'plugin', JSON.stringify(before.mcp_server))
        assert.equal(after.mcp_server?.source, 'plugin')
      })
    },
  },
  {
    name: 'cc-mcp: PostToolUse updatedMCPToolOutput replaces the MCP result the model reads',
    async run(rt) {
      const log = serverLog(rt, 'redact')
      // "| `updatedMCPToolOutput` | Replaces the output for MCP tools only." (PostToolUse)
      const replaced = {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedMCPToolOutput: 'REDACTED-BY-HOOK',
        },
      }
      const files = {
        'server.mjs': STDIO_SERVER,
        '.mcp.json': { mcpServers: { echo: stdio(log) } },
        'hooks/hooks.json': hooksJson({
          PostToolUse: [
            {
              matcher: 'mcp__plugin_redactkit_echo__.*',
              hooks: [command(`cat >/dev/null; echo '${JSON.stringify(replaced)}'`)],
            },
          ],
        }),
      }
      await withPlugin(rt, 'redactkit', files, async () => {
        const session = await rt.createSession({ title: 'MCP output rewrite' })
        const { read } = await offerAndCall(rt, session, 'redactkit', 'echo', { text: 'secret' })
        assert.equal(events(log).filter((e) => e.event === 'call').length, 1, 'the server ran')
        assert.ok(read.includes('REDACTED-BY-HOOK'), `the model read the replacement: ${read}`)
        assert.ok(!read.includes('echo:secret'), 'the original output never reached the model')
      })
    },
  },
  {
    name: 'cc-mcp: a matcher on the bare server key never fires; the scoped matcher of a hyphenated plugin does',
    async run(rt) {
      const log = serverLog(rt, 'bare')
      const bare = path.join(rt.root, 'cc-mcp-bare.fired')
      const scoped = path.join(rt.root, 'cc-mcp-scoped.fired')
      const files = {
        'server.mjs': STDIO_SERVER,
        '.mcp.json': { mcpServers: { echo: stdio(log) } },
        // "A hook matcher written against the bare server key, such as `mcp__database-tools__.*`,
        // never fires for a plugin-bundled server." (mcp.md)
        'hooks/hooks.json': hooksJson({
          PreToolUse: [
            { matcher: 'mcp__echo__.*', hooks: [command(`cat >/dev/null; touch "${bare}"`)] },
            {
              matcher: 'mcp__plugin_lin-mcp_echo__.*',
              hooks: [command(`cat >/dev/null; touch "${scoped}"`)],
            },
          ],
        }),
      }
      await withPlugin(rt, 'lin-mcp', files, async () => {
        const session = await rt.createSession({ title: 'MCP bare matcher' })
        const { read } = await offerAndCall(rt, session, 'lin-mcp', 'echo', { text: 'ping' })
        assert.ok(read.includes('stdio:echo:ping'), `the call ran: ${read}`)
        assert.ok(!existsSync(bare), 'the bare-key matcher fired')
        assert.ok(existsSync(scoped), 'the scoped matcher of a hyphenated plugin did not fire')
      })
    },
  },
]
