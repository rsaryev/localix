/** What the Claude Code plugin skill scenarios (`scenarios-cc-skills-*.mjs`) share. */
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { script } from './scenario-helpers.mjs'
import { jsonLines, md, sleep, writeTree } from './scenarios-cc-helpers.mjs'

/** Install a plugin written from `files`, run `body` with its record, and remove it again. */
export async function withPlugin(rt, name, files, body) {
  const dir = path.join(rt.root, `cc-skills-${name}`)
  writeTree(dir, {
    '.claude-plugin/plugin.json': JSON.stringify({ name, version: '1.0.0' }),
    ...files,
  })
  const record = await rt.api('/plugins/install', { source: dir, enable: true })
  try {
    return await body(record)
  } finally {
    // Scenarios share one runtime: a plugin left behind would list its skills in later prompts.
    await rt.api('/plugins/remove', { name })
  }
}

/** The skill or command invocations a person sent, each with the instruction the model read. */
export const invocations = (session) =>
  session.messages.flatMap((message) =>
    (message.payload.bindings ?? []).filter((binding) => binding.kind === 'invocation'),
  )

export const lastInstruction = (session) => {
  const found = invocations(session).at(-1)
  assert.ok(found, `no skill or command ran: ${replyOf(session)}`)
  return found.instruction
}

export const replyOf = (session) => JSON.stringify(session.messages.at(-1)?.payload.content ?? '')

/** Every call of a tool in the session, oldest first. */
export const toolItems = (session, tool) =>
  session.messages.flatMap((message) =>
    (message.payload.items ?? []).filter((item) => item.name === tool),
  )

/** What a tool call returned: its result, or its error when it failed. */
export const resultOf = (item) => item.resultText ?? item.errorText ?? ''

/** Every result text a tool returned in the session, oldest first. */
export const toolResults = (session, tool) => toolItems(session, tool).map(resultOf)

/** The session's last call of `tool`; it must exist, or a check of it passes vacuously. */
export function lastCall(session, tool) {
  const found = toolItems(session, tool).at(-1)
  assert.ok(found, `the model never called ${tool}: ${replyOf(session)}`)
  return found
}

/** The system prompt's skill listing: the section the model scans for skills. */
export function skillListing(system) {
  const at = system.indexOf('# Available skills')
  if (at < 0) return ''
  const rest = system.slice(at + 1)
  const end = rest.indexOf('\n# ')
  return end < 0 ? rest : rest.slice(0, end)
}

/**
 * A turn whose model loads a skill through its skill tool, then answers `reply`. The scripted
 * model replays a script it has seen as spent, so a second load in a session needs another reply.
 */
export const loadTurn = (rt, session, name, reply = 'Loaded.') =>
  rt.say(
    session.id,
    `Load. ${script({ localix: [{ tool: 'skill', args: { action: 'get', name } }, reply] })}`,
  )

/** A turn whose model calls bash once. */
export const bashTurn = (rt, session, command) =>
  rt.say(session.id, `Run. ${script({ localix: [{ tool: 'bash', args: { command } }, 'Ran.'] })}`)

/** Composer command specs the API offers (the `/` menu), wherever the snapshot carries them. */
export async function commandSpecs(rt) {
  const out = []
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      if (typeof value.fullName === 'string' && 'pluginName' in value) out.push(value)
      Object.values(value).forEach(walk)
    }
  }
  walk(await rt.api('/capabilities/snapshot'))
  return out
}

/**
 * Send `prompt` and wait until the turn settles, dismissing every permission card it shows:
 * `cards` is how many were shown.
 */
export async function turnWithCards(rt, sessionId, prompt) {
  await rt.send(sessionId, prompt)
  const cards = new Set()
  const deadline = Date.now() + 60_000
  let [quietSince, seen] = [Date.now(), -1]
  while (Date.now() < deadline) {
    const session = await rt.detail(sessionId)
    const pending = session.pendingInteractions ?? []
    for (const { requestId } of pending) {
      cards.add(requestId)
      await rt.call('/tools/interact', { toolCallId: requestId, action: 'dismiss' })
    }
    const count = rt.requests({ session }).length
    if (session.isRunning || pending.length > 0 || count !== seen) {
      ;[quietSince, seen] = [Date.now(), count]
    } else if (Date.now() - quietSince >= 1_500) return { session, cards: cards.size }
    await sleep(250)
  }
  throw new Error(`Session ${sessionId} did not settle`)
}

/**
 * Run `body` while the default agent asks before a shell command `resource` matches, and drop the
 * rule again: scenarios share one runtime.
 */
export async function withAskRule(rt, resource, body) {
  const rule = (effect) =>
    rt.api('/capabilities/rules/apply', {
      agentId: rt.agentIds.localix,
      changes: [{ action: 'tool:bash', resource, effect }],
    })
  await rule('ask')
  try {
    return await body()
  } finally {
    await rule('default')
  }
}

/**
 * Wait until no model request has been logged for a while and the session is idle: a forked
 * child finishes after its parent settles, and must not outlive its plugin into the next scenario.
 */
export async function untilQuiet(rt, sessionId, { quietMs = 1_500, timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let [seen, since] = [rt.requests().length, Date.now()]
  while (Date.now() - since < quietMs) {
    assert.ok(Date.now() < deadline, 'the model kept being asked')
    await sleep(250)
    const count = rt.requests().length
    if (count !== seen) [seen, since] = [count, Date.now()]
  }
  await rt.waitIdle(sessionId)
}

/** The first logged model request `match` accepts, polled: a fork runs after the parent settles. */
export async function untilRequest(rt, match, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = rt.requests().find((request) => request.stream && match(request))
    if (found) return found
    assert.ok(Date.now() < deadline, 'no matching model request')
    await sleep(250)
  }
}

/**
 * A plugin whose skill registers a PreToolUse hook on Bash that appends its stdin (one JSON line
 * per call) and its `$CLAUDE_PLUGIN_ROOT` to files. Invoking the skill makes one bash call, two
 * with `once`.
 */
export async function withHookSkill(rt, name, body, { once = false } = {}) {
  const log = path.join(rt.root, `${name}-stdin.jsonl`)
  const env = path.join(rt.root, `${name}-env.txt`)
  const command = `cat >> "${log}"; echo >> "${log}"; echo "$CLAUDE_PLUGIN_ROOT" >> "${env}"`
  const call = (cmd) => ({ tool: 'bash', args: { command: cmd } })
  const steps = [call('echo HOOK-DURING'), ...(once ? [call('echo HOOK-AGAIN')] : []), 'Ran.']
  const skill = md(
    [
      'description: Guards the shell',
      'hooks:',
      '  PreToolUse:',
      '    - matcher: "Bash"',
      '      hooks:',
      '        - type: command',
      `          command: '${command}'`,
      ...(once ? ['          once: true'] : []),
    ],
    `HOOK-SKILL-BODY ${script({ localix: steps })}`,
  )
  const calls = () => jsonLines(log)
  await withPlugin(rt, name, { 'skills/guard/SKILL.md': skill }, async (record) => {
    const session = await rt.createSession({ title: `Skill hooks ${name}` })
    await body({ session, calls, env: () => readFileSync(env, 'utf8'), record })
  })
}
