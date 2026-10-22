/** What the Claude Code tool hook scenarios (`scenarios-cc-tool-hooks-*.mjs`) share. */
import assert from 'node:assert/strict'

import { existsSync } from 'node:fs'
import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'
import { bash, jsonLines, sleep, writeTree } from './scenarios-cc-helpers.mjs'

/**
 * Every hook runs this recorder: it appends its stdin (plus the CLAUDE_* env and its extra argv)
 * to a log as one JSON line, then answers as `plan.json` says for its label — stdout, stderr,
 * exit code, a sleep. `@CWD@` in the stdout is the stdin `cwd`.
 */
export const RECORDER = `import json, os, sys, time
label, log = sys.argv[1], sys.argv[2]
data = json.loads(sys.stdin.read())
data['_label'] = label
data['_env'] = {k: v for k, v in os.environ.items() if k.startswith('CLAUDE_')}
data['_argv'] = sys.argv[3:]
with open(log, 'a') as f:
    f.write(json.dumps(data) + '\\n')
plan = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plan.json'))).get(label, {})
time.sleep(plan.get('sleep', 0))
sys.stderr.write(plan.get('stderr', ''))
out = plan.get('stdout')
if out is not None:
    text = out if isinstance(out, str) else json.dumps(out)
    sys.stdout.write(text.replace('@CWD@', data.get('cwd', '')))
sys.exit(plan.get('exit', 0))
`

export const pre = (extra) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...extra } })
export const steps = (...list) => script({ localix: list })
/** One matcher group of `event`. */
export const on = (event, matcher, ...handlers) => ({ [event]: [{ matcher, hooks: handlers }] })
/** A file a command touches to prove it ran; never a plugin folder's name. */
export const mark = (rt, name) => path.join(rt.root, `mark-${name}`)
export const touch = (rt, name) => `touch "${mark(rt, name)}"`

/**
 * Install a plugin whose hooks all run the recorder, run `body`, and remove it again: scenarios
 * share one API, and a hook left behind would answer for the next one. `hooks(h, log)` builds the
 * hooks.json `hooks` object; `h(label, extra)` is one recorder handler.
 */
export async function withHooks(rt, name, { hooks, plan = {}, manifest = {} }, body) {
  const dir = path.join(rt.root, name)
  const log = path.join(rt.root, `${name}.jsonl`)
  const h = (label, extra = {}) => ({
    type: 'command',
    command: `python3 "\${CLAUDE_PLUGIN_ROOT}/hook.py" ${label} "${log}"`,
    ...extra,
  })
  const files = {
    '.claude-plugin/plugin.json': JSON.stringify({ name, version: '1.0.0', ...manifest }),
    'hook.py': RECORDER,
    'plan.json': JSON.stringify(plan),
    'hooks/hooks.json': JSON.stringify({ hooks: hooks(h, log) }),
  }
  writeTree(dir, files)
  await rt.api('/plugins/install', { source: dir, enable: true })
  const read = () => jsonLines(log)
  try {
    return await body({ read })
  } finally {
    await rt.api('/plugins/remove', { name })
  }
}

/**
 * Send a message and wait until the turn has asked the model at least once and settled: nothing
 * runs, waits or is queued. A permission card is answered as `card` says: 'approve', 'dismiss',
 * or 'leave' it for a PermissionRequest hook to withdraw (a card nobody withdraws then fails the
 * turn). An answer waits for `ready()` (say, the racing hook has run) and `graceMs` after it.
 */
export async function turn(rt, sessionId, prompt, options = {}) {
  const { card = 'dismiss', ready = () => true, graceMs = 0 } = options
  const before = rt.requests({ session: await rt.detail(sessionId) }).length
  await rt.send(sessionId, prompt)
  const [cards, answered] = [new Set(), new Set()]
  const deadline = Date.now() + 60_000
  let [quietSince, seen, readySince] = [Date.now(), before, undefined]
  while (Date.now() < deadline) {
    const session = await rt.detail(sessionId)
    const pending = session.pendingInteractions ?? []
    for (const { requestId } of pending) cards.add(requestId)
    if (card !== 'leave' && pending.length > 0 && readySince === undefined && ready())
      readySince = Date.now()
    const answering = readySince !== undefined && Date.now() - readySince >= graceMs
    for (const { requestId } of card === 'leave' || !answering ? [] : pending) {
      if (answered.has(requestId)) continue
      answered.add(requestId)
      const answer = { answers: { confirmed: true } }
      await rt.call(
        '/tools/interact',
        card === 'approve'
          ? { toolCallId: requestId, action: 'respond', payload: answer }
          : { toolCallId: requestId, action: 'dismiss' },
      )
    }
    const count = rt.requests({ session }).length
    const busy =
      session.isRunning ||
      pending.length > 0 ||
      (session.queuedMessages?.length ?? 0) > 0 ||
      count === before ||
      count !== seen
    if (busy) [quietSince, seen] = [Date.now(), count]
    else if (Date.now() - quietSince >= 1_500) return { session, cards: cards.size }
    await sleep(250)
  }
  throw new Error(`Session ${sessionId} did not settle`)
}

/** Everything the model read in the session's requests from index `from` on. */
export const readFrom = (rt, session, from) =>
  runs(rt, session, 'localix')
    .slice(from)
    .flatMap((request) => request.messages ?? [])
    .map((message) => message.text)
    .join('\n')

/** What the model read in its request #`index` of the session. */
export const readAt = (rt, session, index) =>
  (runs(rt, session, 'localix')[index]?.messages ?? []).map((message) => message.text).join('\n')

/**
 * One plugin, one session, one turn of `calls`: what the hooks read (`got`), the cards shown,
 * the model's requests and what it read after the first call (`after`).
 */
export function once(rt, name, { hooks, plan, calls, mode, card }) {
  return withHooks(rt, name, { hooks, plan }, async ({ read }) => {
    const session = await rt.createSession({ title: name })
    if (mode) await rt.api(`/sessions/${session.id}`, { permissionMode: mode }, 'PATCH')
    const done = await turn(rt, session.id, `Go. ${steps(...calls, 'Ok.')}`, { card })
    const requests = runs(rt, done.session, 'localix')
    return { ...done, got: read(), requests, after: readAt(rt, done.session, 1) }
  })
}

/** Live `hook.notice` events of a session, from the realtime socket a person's client opens. */
export function listenNotices(rt, sessionId) {
  const notices = []
  const socket = new WebSocket(`${rt.base.replace(/^http/, 'ws')}/rpc/ws?watch=${sessionId}`, {
    headers: { 'x-localix-client': 'session-e2e' },
  })
  socket.onmessage = ({ data }) => {
    const text = String(data)
    if (!text.startsWith('s\n')) return
    const event = JSON.parse(text.split('\n').slice(3).join('\n'))
    if (event.type === 'hook.notice') notices.push(event)
  }
  const opened = new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  return { notices, opened, close: () => socket.close() }
}

/** A plugin with one `userConfig` option, optionally set by the person, read by both hook forms. */
export async function optionScenario(rt, name, value, expected) {
  const option = { type: 'string', title: 'Endpoint', description: 'The endpoint' }
  const userConfig = { api_endpoint: { ...option, default: 'https://default.example' } }
  const exec = (log) => ({
    type: 'command',
    command: 'python3',
    args: ['${CLAUDE_PLUGIN_ROOT}/hook.py', 'exec', log, '${user_config.api_endpoint}'],
  })
  const hooks = (h, log) => on('PreToolUse', 'Bash', h('shell'), exec(log))
  await withHooks(rt, name, { hooks, manifest: { userConfig } }, async ({ read }) => {
    const session = await rt.createSession({ title: name })
    // Localix keeps a person's option values per project: set it for the session's project.
    const values = { api_endpoint: value }
    if (value) await rt.api('/plugins/config', { name, projectId: session.projectId, values })
    await turn(rt, session.id, `Go. ${steps(bash(`printf ${name}`), 'Ok.')}`)
    const [shell, exec] = ['shell', 'exec'].map((label) => read().find((r) => r._label === label))
    assert.ok(shell && exec, 'both hook forms ran')
    // "both export them as the environment variables CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, and
    // CLAUDE_PLUGIN_DATA on the spawned process" (hooks.md, exec form and shell form).
    for (const { _env: env, cwd } of [shell, exec]) {
      assert.equal(env.CLAUDE_PROJECT_DIR, cwd, 'the project root the session started in')
      assert.ok(existsSync(path.join(env.CLAUDE_PLUGIN_ROOT, 'hook.py')), 'plugin root')
      assert.ok(env.CLAUDE_PLUGIN_DATA && existsSync(env.CLAUDE_PLUGIN_DATA), 'plugin data')
      // "CLAUDE_PLUGIN_OPTION_<KEY>: exported to hook processes for every option".
      assert.equal(env.CLAUDE_PLUGIN_OPTION_API_ENDPOINT, expected)
    }
    // "`${user_config.KEY}`: substituted in … exec-form hook args".
    assert.deepEqual(exec._argv, [expected], 'user_config in exec args')
  })
}

export const labels = (got) => got.map((r) => r._label)
