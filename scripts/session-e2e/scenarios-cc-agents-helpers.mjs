/** What the Claude Code plugin agent scenarios (`scenarios-cc-agents-*.mjs`) share. */
import assert from 'node:assert/strict'

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { script } from './scenario-helpers.mjs'
import { bash, jsonLines, md, writeTree } from './scenarios-cc-helpers.mjs'

/** An agent file: frontmatter lines, then the body (its system prompt). */
export const agentFile = md

/**
 * A hook command that appends what it read on stdin (and its CLAUDE_* env) to `<root>/<tag>.jsonl`,
 * then prints `out` unless the input says a stop hook is already active.
 */
export function hookCommand(rt, tag, out) {
  const logger = path.join(rt.root, 'cc-agents-hook.py')
  if (!existsSync(logger))
    writeFileSync(
      logger,
      [
        'import json, os, sys',
        'data = json.load(sys.stdin)',
        "env = {k: v for k, v in os.environ.items() if k.startswith('CLAUDE_')}",
        "with open(sys.argv[1], 'a') as f:",
        "    f.write(json.dumps({'input': data, 'env': env}) + '\\n')",
        "if len(sys.argv) > 2 and not data.get('stop_hook_active'):",
        '    print(sys.argv[2])',
      ].join('\n'),
    )
  const file = path.join(rt.root, `${tag}.jsonl`)
  return `python3 '${logger}' '${file}'${out ? ` '${JSON.stringify(out)}'` : ''}`
}

/** What the hooks (or an MCP server) logged under `tag`: one entry per call, oldest first. */
export const hookLog = (rt, tag) => jsonLines(path.join(rt.root, `${tag}.jsonl`))

/**
 * A stdio MCP server entry (absolute paths, no plugin variables) for a dependency-free server that
 * lists one `echo` tool and logs `{ event: 'start' }` to `<root>/<tag>.jsonl` when it is started.
 */
export function mcpServer(rt, tag) {
  const server = path.join(rt.root, 'cc-agents-mcp.mjs')
  if (!existsSync(server))
    writeFileSync(
      server,
      [
        "import { appendFileSync } from 'node:fs'",
        "import { createInterface } from 'node:readline'",
        "appendFileSync(process.env.E2E_LOG, JSON.stringify({ event: 'start' }) + '\\n')",
        "const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')",
        "const ECHO = { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }",
        "createInterface({ input: process.stdin }).on('line', (line) => {",
        '  let msg',
        '  try { msg = JSON.parse(line) } catch { return }',
        '  if (msg.id === undefined) return',
        "  if (msg.method === 'initialize') return send({ id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'e2e-agents', version: '1.0.0' } } })",
        "  if (msg.method === 'tools/list') return send({ id: msg.id, result: { tools: [ECHO] } })",
        "  if (msg.method === 'tools/call') return send({ id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + (msg.params?.arguments?.text ?? '') }] } })",
        "  if (msg.method === 'ping') return send({ id: msg.id, result: {} })",
        "  send({ id: msg.id, error: { code: -32601, message: 'Method not found' } })",
        "}).on('close', () => process.exit(0))",
      ].join('\n'),
    )
  return { command: 'node', args: [server], env: { E2E_LOG: path.join(rt.root, `${tag}.jsonl`) } }
}

/** Install the plugins (`{ name: files }`), run `body`, and remove them: scenarios share the API. */
export async function withPlugins(rt, plugins, body) {
  const installed = []
  try {
    for (const [name, files] of Object.entries(plugins)) {
      const dir = path.join(rt.root, name)
      writeTree(dir, {
        '.claude-plugin/plugin.json': JSON.stringify({ name, version: '1.0.0' }),
        ...files,
      })
      await rt.api('/plugins/install', { source: dir, enable: true })
      installed.push(name)
    }
    return await body()
  } finally {
    for (const name of installed) await rt.call('/plugins/remove', { name })
  }
}

/** A step that delegates `childSteps` to `agent` and waits for the report. */
export const delegateStep = (agent, childSteps, extra = {}) => ({
  tool: 'delegate',
  args: {
    task: `Do your part. ${script({ localix: childSteps })}`,
    title: `As ${agent}`,
    agent,
    wait: true,
    ...extra,
  },
})

/** A chat in `bypass`, so a child's tool calls run without waiting on a permission card. */
export async function openChat(rt, title) {
  const session = await rt.createSession({ title })
  await rt.api(`/sessions/${session.id}`, { permissionMode: 'bypass' }, 'PATCH')
  return session
}

/** Send `steps` as the parent's script in `session` (or a new chat); its and its children's runs. */
export async function delegateTurn(rt, title, steps, { session, timeoutMs = 90_000 } = {}) {
  session ??= await openChat(rt, title)
  const after = await rt.say(session.id, `Go. ${script({ localix: steps })}`, { timeoutMs })
  return { after, ...requestsOf(rt, after) }
}

/** The parent's model requests, and every other session's (its children), by session. */
export function requestsOf(rt, parent) {
  const parentRef = `LOCALIX-${parent.seq}`
  const all = rt.requests().filter((request) => request.stream && request.sessionId)
  const parentRuns = all.filter((request) => request.sessionId === parentRef)
  const children = new Map()
  for (const request of all) {
    if (request.sessionId === parentRef || request.at < parentRuns[0]?.at) continue
    children.set(request.sessionId, [...(children.get(request.sessionId) ?? []), request])
  }
  return { parentRuns, children: [...children.values()] }
}

/** The child whose system prompt carries `marker` (its agent's body). */
export function childOf(children, marker) {
  const found = children.find((runs) => runs[0].system.startsWith(marker))
  assert.ok(found, `no child ran with the system prompt "${marker}"`)
  return found
}

/**
 * What the model read in a request besides its system prompt and the scripts: a script names every
 * reply it scripts, so a message carrying one would prove nothing about what came back.
 */
export const heard = (request) =>
  request.messages
    .map((message) => message.text)
    .filter((text) => !text.includes('SCRIPT{'))
    .join('\n')

/** A plugin hooks.json from `{ Event: [[matcher, command], …] }`. */
export const hooksJson = (events) =>
  JSON.stringify({
    hooks: Object.fromEntries(
      Object.entries(events).map(([event, entries]) => [
        event,
        entries.map(([matcher, command]) => ({
          ...(matcher ? { matcher } : {}),
          hooks: [{ type: 'command', command }],
        })),
      ]),
    ),
  })

/** One plugin with one agent `name` (frontmatter `front`, body `body`) and optional hooks. */
export const agentPlugin = (name, front, body, events) => ({
  [`agents/${name}.md`]: agentFile(
    [`name: ${name}`, 'description: Does its part.', ...front],
    body,
  ),
  ...(events ? { 'hooks/hooks.json': hooksJson(events) } : {}),
})

/** What the delegate call titled `title` returned to the parent, as the parent read it. */
export function delegateOutput(request, title) {
  const output = request.messages.find(
    (message) => message.role === 'function_call_output' && message.text.includes(`"${title}"`),
  )
  assert.ok(output, `no delegate result for "${title}": ${JSON.stringify(request.messages)}`)
  return output.text
}

/** A child of an agent with `maxTurns: 2` whose script would take four turns. */
export const cappedSteps = (first = bash('echo T1')) => [
  first,
  bash('echo T2'),
  bash('echo T3'),
  'FULL',
]
export const cappedFiles = () =>
  agentPlugin('capped', ['tools: Bash', 'maxTurns: 2'], 'CAPPED body.')
