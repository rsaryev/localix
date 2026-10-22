/**
 * What the official-plugin scenarios (`scenarios-cc-official-*.mjs`) share: the plugin trees of
 * `CC_OFFICIAL_PLUGINS_DIR`, a spy plugin that records what a hook received (stdin, environment,
 * working directory), and a realtime socket that watches the session the way the app does.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { scratchGitEnv } from '@localixai/testing'

import { script } from './scenario-helpers.mjs'

export const SOURCE = process.env.CC_OFFICIAL_PLUGINS_DIR

export const SPY = `import json, os, sys
event, out = sys.argv[1], sys.argv[2]
data = json.load(sys.stdin)
env = {k: os.environ.get(k) for k in ('CLAUDE_CODE_SESSION_ID', 'CLAUDE_PROJECT_DIR')}
with open(os.path.join(out, event + '.jsonl'), 'a') as f:
    f.write(json.dumps({'input': data, 'env': env, 'pwd': os.getcwd()}) + '\\n')
`

/** Copy an official plugin into the run's root, let `patch` adjust the copy, install it. */
export async function install(rt, name, patch) {
  const from = path.join(SOURCE, name)
  assert.ok(existsSync(from), `plugin ${name} not found in ${SOURCE}`)
  const to = path.join(rt.root, 'official', name)
  cpSync(from, to, { recursive: true })
  patch?.(to)
  await rt.api('/plugins/install', { source: to, enable: true })
}

/**
 * security-guidance as configured with `ENABLE_CODE_SECURITY_REVIEW=0`, its documented switch for
 * the reviews that call a model: its SessionStart hook then installs nothing from PyPI and its Stop
 * review stays quiet, so only the pattern warnings on Edit and Write remain, offline.
 */
export function patternRulesOnly(dir) {
  const file = path.join(dir, 'hooks/hooks.json')
  const config = JSON.parse(readFileSync(file, 'utf8'))
  for (const groups of Object.values(config.hooks))
    for (const group of groups)
      for (const hook of group.hooks) hook.command = `ENABLE_CODE_SECURITY_REVIEW=0 ${hook.command}`
  writeFileSync(file, JSON.stringify(config))
}

/** A spy plugin whose hooks append what they read to `<dir>/out/<Event>.jsonl`. */
export async function installSpy(rt, tag, events) {
  const dir = path.join(rt.root, `spy-${tag}`)
  const out = path.join(dir, 'out')
  for (const sub of ['.claude-plugin', 'hooks', 'out'])
    mkdirSync(path.join(dir, sub), { recursive: true })
  writeFileSync(path.join(dir, 'spy.py'), SPY)
  const command = (event) => `python3 "\${CLAUDE_PLUGIN_ROOT}/spy.py" ${event} ${out}`
  const hooks = Object.fromEntries(
    events.map((event) => [event, [{ hooks: [{ type: 'command', command: command(event) }] }]]),
  )
  writeFileSync(
    path.join(dir, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: `spy-${tag}`, version: '1.0.0' }),
  )
  writeFileSync(path.join(dir, 'hooks/hooks.json'), JSON.stringify({ hooks }))
  await rt.api('/plugins/install', { source: dir, enable: true })
  return (event) => {
    const file = path.join(out, `${event}.jsonl`)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  }
}

/** Watch a session on the realtime socket, as the app does; resolves once the socket is open. */
export function watch(rt, sessionId) {
  const events = []
  const socket = new WebSocket(`${rt.base.replace(/^http/, 'ws')}/rpc/ws?watch=${sessionId}`)
  socket.addEventListener('message', ({ data }) => {
    const text = String(data)
    if (!text.startsWith('s\n')) return
    try {
      events.push(JSON.parse(text.split('\n').slice(3).join('\n')))
    } catch {
      /* not a session event */
    }
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the realtime socket did not open')), 10_000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve({
        notices: () => events.filter((e) => e.type === 'hook.notice').map((e) => e.message),
        close: () => socket.close(),
      })
    })
  })
}

let used = 0

/**
 * Install `names`, run `body` in a project folder of its own, then remove everything again. Each
 * call gets fresh folders: no rule file, loop state or spy record carries over between scenarios.
 */
export async function withPlugins(rt, names, { git = false, spy, patch = {} } = {}, body) {
  const tag = `${names[0]}-${++used}`
  const dir = path.join(rt.root, 'projects', tag)
  mkdirSync(dir, { recursive: true })
  if (git) {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: scratchGitEnv() })
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'init')
  }
  const project = await rt.api('/projects', { name: `cc-official ${tag}`, workingDir: dir })
  const installed = []
  let watcher
  try {
    for (const name of names) {
      await install(rt, name, patch[name])
      installed.push(name)
    }
    const spied = spy ? await installSpy(rt, tag, spy) : undefined
    if (spy) installed.push(`spy-${tag}`)
    const session = await rt.createSession({ title: tag, projectId: project.id })
    watcher = await watch(rt, session.id)
    return await body({ dir, session, spy: spied, notices: () => watcher.notices().join('\n') })
  } finally {
    watcher?.close()
    // Scenarios share one API: a hook or agent left enabled would act in the next one.
    for (const name of installed) await rt.call('/plugins/remove', { name })
    await rt.call(`/projects/${project.id}`, undefined, 'DELETE')
  }
}

export const gitIn = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, env: scratchGitEnv() }).toString()

/** Everything a request carried besides the system prompt: message starts and whole reminders. */
export const read = (request) =>
  [...request.messages.map((message) => message.text), ...request.reminders].join('\n')

/** The expanded command a person's message invoked, as the model receives it. */
export const invocation = (session) =>
  session.messages
    .flatMap((message) => message.payload.bindings ?? [])
    .findLast((binding) => binding.kind === 'invocation')?.instruction ?? ''

/** The tool calls an agent made in the session, each with the result the model read. */
export const toolCalls = (session) =>
  session.messages.flatMap((message) =>
    (message.payload.items ?? []).filter((item) => item.toolCallId),
  )

/** A delegated child's model requests, found by the reply its own script gave. */
export const childRun = (rt, answer) =>
  rt.requests({ speaker: 'localix' }).find((r) => r.stream && r.answered.text === answer)

export const delegateTo = (agent, answer) => ({
  tool: 'delegate',
  args: { task: `Go. ${script({ localix: [answer] })}`, title: agent, agent, wait: true },
})

/** A Write of `notes/todo.md` with hookify and a Pre/PostToolUse spy beside it. */
export async function spiedWrite(rt, body) {
  const events = ['PreToolUse', 'PostToolUse']
  await withPlugins(rt, ['hookify'], { spy: events }, async ({ dir, session, spy }) => {
    const write = { files: [{ path: 'notes/todo.md', content: 'Ship it.\n' }] }
    await rt.say(session.id, `Note it. ${script({ localix: [{ tool: 'write', args: write }] })}`)
    const [pre] = spy('PreToolUse')
    const [post] = spy('PostToolUse')
    assert.ok(pre && post, 'both hooks ran')
    body({ dir, pre, post })
  })
}

export const rule = (lines, message) => ['---', ...lines, '---', '', message].join('\n')

export const HOOKIFY_WARN_RM = rule(
  ['name: warn-rm', 'enabled: true', 'event: bash', 'pattern: rm\\s+-rf'],
  'WARN-RM-RULE: check the path before deleting.',
)
export const HOOKIFY_BLOCK_ENV = rule(
  [
    'name: block-env',
    'enabled: true',
    'event: file',
    'action: block',
    'conditions:',
    '  - field: file_path',
    '    operator: regex_match',
    '    pattern: \\.env$',
  ],
  'BLOCK-ENV-RULE: secrets never go in .env files here.',
)
export const HOOKIFY_REQUIRE_TESTS = rule(
  [
    'name: require-tests',
    'enabled: true',
    'event: stop',
    'action: block',
    'conditions:',
    '  - field: transcript',
    '    operator: not_contains',
    '    pattern: npm test 42',
  ],
  'REQUIRE-TESTS-RULE: run the tests before stopping.',
)

export const SECURITY_TAG = '[from security-guidance@claude-code-plugins plugin]'

/** A commit command that needs no git identity from the machine. */
export const gitCommit = (message) =>
  `git -c user.email=e2e@example.com -c user.name=E2E commit -q -m "${message}"`
