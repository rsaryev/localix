/** What the plugin lifecycle scenarios (`scenarios-cc-lifecycle-*.mjs`) share. */
import assert from 'node:assert/strict'

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { lastRun, script } from './scenario-helpers.mjs'
import { writeTree } from './scenarios-cc-helpers.mjs'

export const manifest = (name, extra = {}) =>
  JSON.stringify({ name, version: '1.0.0', description: `${name} plugin`, ...extra })
export const skill = (name, description) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nFollow ${name}.\n`
export const hook = (event, command) =>
  JSON.stringify({ hooks: { [event]: [{ hooks: [{ type: 'command', command }] }] } })
export const BAD_OPTION = { key: { type: 'string', title: 'Key', description: 'Key', bogus: true } }

/** A chat the person types `/plugin …` into; `say` returns the reply they see. */
export async function chat(rt, input = {}) {
  const session = await rt.createSession({ title: 'Plugin lifecycle', ...input })
  const say = async (text) => rt.transcript(await rt.say(session.id, text)).at(-1).text
  return { session, say }
}

/** One ordinary turn in a fresh chat: the model request it made. */
export async function probe(rt, input = {}) {
  const session = await rt.createSession({ title: 'Probe', ...input })
  return lastRun(rt, await rt.say(session.id, `Probe. ${script({ localix: ['Ok.'] })}`))
}

/** Scenarios share one API: remove what a scenario may have left, ignoring "not installed". */
export async function cleanup(rt, { plugins = [], markets = [], projectId } = {}) {
  for (const name of markets) await rt.call('/plugins/marketplaces/remove', { name })
  for (const name of plugins) await rt.call('/plugins/remove', { name, projectId })
}

/**
 * Write plugin `name` from `files` (a manifest is added when absent), install it with
 * `/plugin install <dir>` unless `install` is false, run `body`, and remove it again.
 */
export async function withPlugin(rt, name, files, body, { install = true } = {}) {
  const src = path.join(rt.root, `src-${name}`)
  writeTree(src, { '.claude-plugin/plugin.json': manifest(name), ...files })
  const { say } = await chat(rt)
  try {
    const installed = install ? await say(`/plugin install ${src}`) : null
    await body({ say, src, installed })
  } finally {
    await cleanup(rt, { plugins: [name] })
  }
}

/**
 * A local marketplace folder for catalog `market` with one plugin folder per entry of `plugins`,
 * added with `/plugin marketplace add`; `body` runs, then the marketplace and plugins go.
 */
export async function withMarket(rt, market, plugins, body) {
  const dir = path.join(rt.root, `market-${market}`)
  const entries = Object.keys(plugins).map((name) => ({
    name,
    source: `./plugins/${name}`,
    description: `${name} entry`,
  }))
  const catalog = { name: market, owner: { name: 'E2E' }, plugins: entries }
  writeTree(dir, { '.claude-plugin/marketplace.json': JSON.stringify(catalog) })
  for (const [name, files] of Object.entries(plugins))
    writeTree(path.join(dir, 'plugins', name), {
      '.claude-plugin/plugin.json': manifest(name),
      ...files,
    })
  const { say } = await chat(rt)
  try {
    const added = await say(`/plugin marketplace add ${dir}`)
    await body({ say, dir, added })
  } finally {
    await cleanup(rt, { markets: [market], plugins: Object.keys(plugins) })
  }
}

export const pluginsDir = (rt) => path.join(rt.root, 'home', '.localix', 'plugins')
export const bump = (dir, name, version) =>
  writeTree(dir, { '.claude-plugin/plugin.json': manifest(name, { version }) })

/** Every file under `dir` whose bytes contain `needle` (the database and its WAL included). */
export function filesContaining(dir, needle) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesContaining(file, needle))
    else if (entry.isFile() && statSync(file).size < 64 * 1024 * 1024)
      if (readFileSync(file).includes(needle)) found.push(file)
  }
  return found
}

/** The sensitive option's value `optionEnv` saves for plugin `name`: unique, so a scan finds it. */
export const tokenOf = (name) => `LC-${name}-TOKEN-7731`

/**
 * Install a plugin whose UserPromptSubmit hook records its `CLAUDE_PLUGIN_OPTION_*` env, save its
 * options (for project `saveIn`, or none), reload, run one turn in project `probeIn`, and call
 * `inspect` while the plugin is still installed.
 */
export async function optionEnv(rt, name, { saveIn, probeIn, inspect } = {}) {
  const out = path.join(rt.root, `${name}.env`)
  const userConfig = {
    api_url: { type: 'string', title: 'URL', description: 'URL' },
    api_token: { type: 'string', title: 'Token', description: 'Token', sensitive: true },
  }
  const files = {
    '.claude-plugin/plugin.json': manifest(name, { userConfig }),
    'hooks/hooks.json': hook(
      'UserPromptSubmit',
      `cat >/dev/null; env | grep '^CLAUDE_PLUGIN_OPTION_' > "${out}"`,
    ),
  }
  let env = ''
  await withPlugin(rt, name, files, async ({ say }) => {
    const values = { api_url: 'https://opt.example', api_token: tokenOf(name) }
    await rt.api('/plugins/config', { name, values, ...(saveIn ? { projectId: saveIn } : {}) })
    await say('/plugin reload')
    await probe(rt, probeIn ? { projectId: probeIn } : {})
    assert.ok(existsSync(out), 'the hook never ran')
    env = readFileSync(out, 'utf8')
    await inspect?.()
  })
  return env
}

/** A project whose working folder exists, so its chats can run hooks there. */
export async function project(rt, name) {
  const workingDir = path.join(rt.root, name)
  mkdirSync(workingDir, { recursive: true })
  return rt.api('/projects', { name, workingDir })
}

export const MCP_SERVER = `import json, sys
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get('id') is None: continue
    m = msg.get('method')
    res = {}
    if m == 'initialize': res = {'protocolVersion': msg['params'].get('protocolVersion', '2024-11-05'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'lc', 'version': '1'}}
    if m == 'tools/list': res = {'tools': [{'name': 'lc_ping', 'description': 'Ping', 'inputSchema': {'type': 'object'}}]}
    if m == 'tools/call': res = {'content': [{'type': 'text', 'text': 'pong'}]}
    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': msg['id'], 'result': res}) + '\\n'); sys.stdout.flush()
`

// "callable as: mcp__plugin_<plugin>_<server>__<tool>" (mcp.md), and Localix's own spelling: the
// scenario tests whether the server is there, not how its tool is named (cc-mcp does that).
export const PARTS_MCP_TOOLS = [
  'mcp__plugin_lc-parts_lcparts__lc_ping',
  'mcp_lc_parts_lcparts_lc_ping',
]
export const PARTS_AGENT_BODY = 'LC-PARTS-AGENT-BODY'

/**
 * One turn that tries each part of `lc-parts`: it activates the MCP server's tool and delegates
 * to the plugin agent. Returns the turn's last request and whether the agent's child ran.
 */
export async function partsTurn(rt) {
  const from = rt.requests().length
  const session = await rt.createSession({ title: 'Probe' })
  const task = `Check. ${script({ localix: ['Checked.'] })}`
  const steps = [
    { tool: 'activate_tools', args: { names: PARTS_MCP_TOOLS } },
    { tool: 'delegate', args: { task, title: 'Parts', agent: 'lc-parts:parts-agent', wait: true } },
    'Ok.',
  ]
  const after = await rt.say(session.id, `Probe. ${script({ localix: steps })}`)
  const children = rt.requests().slice(from)
  return {
    last: lastRun(rt, after),
    agentRan: children.some((request) => request.system.startsWith(PARTS_AGENT_BODY)),
  }
}
