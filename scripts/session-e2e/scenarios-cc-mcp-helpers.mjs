/** What the Claude Code plugin MCP scenarios (`scenarios-cc-mcp-*.mjs`) share. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'

import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'
import {
  jsonLines,
  until as untilTruthy,
  writeTree as writeTexts,
} from './scenarios-cc-helpers.mjs'

/**
 * A dependency-free stdio MCP server: newline-delimited JSON-RPC (initialize, tools/list,
 * tools/call, ping). It logs its start (argv, the plugin/E2E environment, pid), every call and
 * its exit to `$E2E_LOG`, so a scenario asserts on exactly what the server was given.
 */
export const STDIO_SERVER = `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const log = process.env.E2E_LOG
const note = (entry) => log && appendFileSync(log, JSON.stringify(entry) + '\\n')
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  /^(CLAUDE_PLUGIN_|CLAUDE_PROJECT_DIR$|E2E_)/.test(k)))
note({ event: 'start', pid: process.pid, argv: process.argv.slice(1), env })
const tag = process.env.E2E_TAG ?? 'stdio'
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
const ECHO = { name: 'echo', description: 'Echo the text back', annotations: { readOnlyHint: true },
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.id === undefined) return
  if (msg.method === 'initialize')
    return send({ id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'e2e-stdio', version: '1.0.0' } } })
  if (msg.method === 'tools/list') return send({ id: msg.id, result: { tools: [ECHO] } })
  if (msg.method === 'tools/call') {
    note({ event: 'call', name: msg.params?.name, arguments: msg.params?.arguments })
    const text = tag + ':echo:' + (msg.params?.arguments?.text ?? '')
    return send({ id: msg.id, result: { content: [{ type: 'text', text }] } })
  }
  if (msg.method === 'ping') return send({ id: msg.id, result: {} })
  send({ id: msg.id, error: { code: -32601, message: 'Method not found' } })
}).on('close', () => { note({ event: 'exit' }); process.exit(0) })
process.on('SIGTERM', () => { note({ event: 'exit', signal: 'SIGTERM' }); process.exit(0) })
`

/** writeTree, with a file given as an object written as its JSON. */
export const writeTree = (dir, files) =>
  writeTexts(
    dir,
    Object.fromEntries(
      Object.entries(files).map(([file, text]) => [
        file,
        typeof text === 'string' ? text : JSON.stringify(text),
      ]),
    ),
  )

/** Install a plugin written from `files`, run `body(record)`, and always remove it again. */
export async function withPlugin(rt, name, files, body) {
  const dir = path.join(rt.root, `cc-mcp-${name}`)
  writeTree(dir, { '.claude-plugin/plugin.json': { name, version: '1.0.0' }, ...files })
  const record = await rt.api('/plugins/install', { source: dir, enable: true })
  try {
    await body(record)
  } finally {
    await rt.call('/plugins/remove', { name })
  }
}

/** A stdio server entry that runs the plugin's own server script and logs to `log`. */
export const stdio = (log, extra = {}) => ({
  command: 'node',
  args: ['${CLAUDE_PLUGIN_ROOT}/server.mjs', ...(extra.args ?? [])],
  env: { E2E_LOG: log, ...extra.env },
})

export const serverLog = (rt, name) => path.join(rt.root, `cc-mcp-${name}.jsonl`)
export const events = jsonLines

// "The full form is `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`, where any character
// outside `A-Z`, `a-z`, `0-9`, `_`, and `-` is replaced with `_`." (mcp.md)
export const ccName = (plugin, server, tool) =>
  `mcp__plugin_${plugin}_${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, '_')
// Localix's own spelling, so the scenarios that test behaviour (not naming) still reach the tool.
export const localName = (plugin, server, tool) =>
  `mcp_${plugin}_${server}_${tool}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64)

/** One turn of the scripted `localix` agent; returns the model requests that turn made. */
export async function turn(rt, session, text, steps) {
  const before = runs(rt, session).length
  const after = await rt.say(session.id, `${text} ${script({ localix: steps })}`)
  return runs(rt, after).slice(before)
}

/**
 * Bring a plugin MCP tool onto the wire (Localix defers MCP schemas behind `activate_tools`, as
 * Claude Code defers them behind tool search) and return the name the model was offered.
 */
export async function offer(rt, session, plugin, server, tool = 'echo') {
  const names = [ccName(plugin, server, tool), localName(plugin, server, tool)]
  const made = await turn(rt, session, 'Load the tool.', [
    { tool: 'activate_tools', args: { names } },
    'Loaded.',
  ])
  const roster = made.at(-1)?.tools ?? []
  return names.find((name) => roster.includes(name))
}

/** Call `name` with `args` in one turn; returns what the model read after the call. */
export async function callTool(rt, session, name, args) {
  const made = await turn(rt, session, 'Use the tool.', [{ tool: name, args }, 'Reported.'])
  assert.ok(made.length >= 2, `the call made no follow-up request: ${JSON.stringify(made)}`)
  return made
    .at(-1)
    .messages.map((message) => message.text)
    .join('\n')
}

/** Offer and call a plugin tool; fails with the roster when the tool never reached the model. */
export async function offerAndCall(rt, session, plugin, server, args) {
  const name = await offer(rt, session, plugin, server)
  assert.ok(name, `no tool of ${plugin}:${server} reached the model`)
  return { name, read: await callTool(rt, session, name, args) }
}

/** Bounded polling on a condition the API reaches on its own time. */
export async function until(check, what, timeoutMs = 15_000) {
  await untilTruthy(check, what, timeoutMs)
}

export const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const hooksJson = (events) => ({ hooks: events })
export const command = (text) => ({ type: 'command', command: text })

/**
 * Save plugin options as the Settings row of the chat's project saves them: a chat runs in a
 * project (`PRJ-1` by default), and Localix reads a plugin's options from that project's row.
 * The scenarios that use it test substitution, not where the value is kept: the user-level
 * value ("saved under `pluginConfigs` in the user's `settings.json`") is the global-config
 * scenario's to prove.
 */
export const configure = (rt, session, name, values) =>
  rt.api('/plugins/config', { name, projectId: session.projectId, values })

/** A plugin with one server that cannot start (its script is missing) beside a working one. */
export async function withBrokenPlugin(rt, body) {
  const log = serverLog(rt, `broken-${Date.now()}`)
  const files = {
    'server.mjs': STDIO_SERVER,
    '.mcp.json': {
      mcpServers: {
        broken: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/missing-server.mjs'] },
        echo: stdio(log),
      },
    },
  }
  await withPlugin(rt, 'brokenkit', files, async () => {
    const session = await rt.createSession({ title: 'MCP broken' })
    // A turn gathers the servers, so the broken one has been tried before anything is asked. A
    // connect slower than the gather's budget is backgrounded as still connecting and settles by
    // a later turn, so turns repeat (bounded) until the model no longer reads it as connecting.
    await until(async () => {
      await turn(rt, session, 'Start.', ['Started.'])
      return !/connecting/i.test(brokenServerRow(rt, session) ?? '')
    }, 'the broken server is no longer connecting')
    await body(session, log)
  })
}

/** The broken server's names: Localix's `<plugin>_<server>` record and Claude Code's label. */
export const BROKEN_SERVER = /brokenkit_broken|plugin:brokenkit:broken/

/**
 * The runtime context each turn of `session` sent the model, oldest first, exactly as the API
 * stored it with the turn. The request log keeps only the first 400 characters of a message, and
 * the MCP server inventory sits further into the context message than that.
 */
export function sentContexts(rt, session) {
  const db = new Database(path.join(rt.root, 'home', '.localix', 'localix.db'), { readonly: true })
  try {
    return db
      .query(
        `SELECT turn_context_json FROM agent_message_model_context
         WHERE session_id = ? AND turn_context_json IS NOT NULL ORDER BY updated_at, rowid`,
      )
      .all(session.id)
      .map((row) => JSON.parse(row.turn_context_json).content ?? '')
  } finally {
    db.close()
  }
}

/**
 * The broken server's row in the newest context that names it. A turn's context carries only the
 * sections that changed, so the newest mention is what the model currently knows about it.
 */
export function brokenServerRow(rt, session) {
  for (const content of sentContexts(rt, session).reverse()) {
    const row = content.split('\n').find((line) => BROKEN_SERVER.test(line))
    if (row) return row
  }
  return undefined
}
