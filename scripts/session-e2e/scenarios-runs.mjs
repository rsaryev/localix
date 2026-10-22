/** Session E2E: what else a run inherits — commands, forks, permission modes, delegation. */
import assert from 'node:assert/strict'

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { lastRun, runs, script } from './scenario-helpers.mjs'

/** A mod in the Claude Code format: a guard on Bash, a note on every prompt, a command. */
const GUARD_MOD = `
let refused = 0
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tally', description: 'How many calls the guard refused' })
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    refused += 1
    return { deny: 'Bash is off in this chat.' }
  })
  on('prompt.submit', async ($, e, next) =>
    next({ ...e, text: e.text + ' (guard-mod was here)', context: ['A note from guard-mod.'] }),
  )
  on('command.run', { command: 'tally' }, async () => ({ text: refused + ' refused' }))
}
`

function writeTree(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
}

/** Poll a condition the API reaches on its own time (a mod loads after its plugin is enabled). */
async function waitFor(check, what, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting until ${what}`)
}

export const RUN_SCENARIOS = [
  {
    name: '/agents add seats the named agent',
    async run(rt) {
      const session = await rt.createSession({ title: 'Agents add' })
      const after = await rt.say(session.id, '/agents add @checker')
      assert.deepEqual(
        after.agents.map((agent) => agent.handle),
        ['localix', 'checker'],
      )
    },
  },
  {
    name: 'a fork keeps the source’s permission mode',
    async run(rt) {
      const session = await rt.createSession({ title: 'Fork source' })
      await rt.api(`/sessions/${session.id}`, { permissionMode: 'plan' }, 'PATCH')
      await rt.say(session.id, `Look. ${script({ localix: ['Looked.'] })}`)
      const fork = await rt.api(`/sessions/${session.id}/fork`, {})
      assert.equal(fork.permissionMode, 'plan')
    },
  },
  {
    name: 'autonomous: the tools that only reach a person are withheld',
    async run(rt) {
      const session = await rt.createSession({ title: 'Autonomous' })
      await rt.api(`/sessions/${session.id}`, { permissionMode: 'autonomous' }, 'PATCH')
      const after = await rt.say(session.id, `Go. ${script({ localix: ['Going.'] })}`)
      const request = lastRun(rt, after)
      assert.ok(!request.tools.includes('ask') && !request.tools.includes('configure'))
      assert.ok(request.system.includes('Nobody can answer a question in this run'))
    },
  },
  {
    name: 'plan mode works in a chat with one agent',
    async run(rt) {
      const session = await rt.createSession({ title: 'Lone plan' })
      await rt.api(`/sessions/${session.id}`, { permissionMode: 'plan' }, 'PATCH')
      const after = await rt.say(session.id, `Plan it. ${script({ localix: ['Planning.'] })}`)
      const request = lastRun(rt, after)
      assert.ok(request.system.includes('# Plan mode'))
      assert.ok(request.tools.includes('plan'))
    },
  },
  {
    name: 'a delegated child runs isolated: no roster, no team tools',
    async run(rt) {
      const session = await rt.createSession({ title: 'Delegation' })
      const childTask = `Count the files. ${script({ localix: ['Counted 3 files.'] })}`
      const steps = {
        localix: [
          { tool: 'delegate', args: { task: childTask, title: 'Count files', wait: true } },
          'The child counted 3 files.',
        ],
      }
      const after = await rt.say(session.id, `Delegate a count. ${script(steps)}`, {
        timeoutMs: 90_000,
      })
      const parentRef = `LOCALIX-${after.seq}`
      const child = rt
        .requests({ speaker: 'localix' })
        .find(
          (request) =>
            request.stream &&
            request.sessionId &&
            request.sessionId !== parentRef &&
            request.answered.text === 'Counted 3 files.',
        )
      assert.ok(child, 'the child never ran')
      assert.ok(!child.contextHeadings.includes('# Conversation participants'))
      for (const tool of ['delegate', 'skip_answer', 'set_topic', 'ask'])
        assert.ok(!child.tools.includes(tool), `the child holds ${tool}`)
      assert.equal(rt.transcript(after).at(-1).text, 'The child counted 3 files.')
    },
  },
  {
    name: '/workflows gives the agent the rule for bringing a team in',
    async run(rt) {
      const session = await rt.createSession({ title: 'Workflows' })
      const after = await rt.say(
        session.id,
        `/workflows ship a pricing page ${script({ localix: ['Breaking it down.'] })}`,
      )
      assert.ok(lastRun(rt, after).system.includes('Bring in a suitable agent'))
    },
  },
  {
    name: 'a mod guards a tool call, adds a note to the prompt and answers its command',
    async run(rt) {
      const dir = path.join(rt.root, 'guard-mod')
      writeTree(dir, {
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'guard-mod', version: '1.0.0' }),
        'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),
        'hooks/register.js': GUARD_MOD,
      })
      await rt.api('/plugins/install', { source: dir, enable: true })
      await waitFor(async () => (await rt.api('/mods')).mods.includes('guard-mod'), 'the mod loads')

      const session = await rt.createSession({ title: 'Mod guard' })
      const steps = { localix: [{ tool: 'bash', args: { command: 'ls' } }, 'Bash was refused.'] }
      const after = await rt.say(session.id, `List the files. ${script(steps)}`)
      const [first, second] = runs(rt, after, 'localix')
      assert.ok(
        first.messages.some((message) => message.text.includes('guard-mod was here')),
        'prompt.submit rewrote the prompt the model reads',
      )
      assert.ok(
        first.reminders.some((reminder) => reminder.includes('A note from guard-mod.')),
        'prompt.submit added its note as a system reminder',
      )
      assert.ok(
        second.messages.some((message) => message.text.includes('Bash is off in this chat')),
        'tool.call refused bash and the model read why',
      )
      const tallied = await rt.say(session.id, '/tally')
      assert.match(rt.transcript(tallied).at(-1).text, /guard-mod: 1 refused/)
    },
  },
  {
    name: 'claude code hooks: a command expansion and a tool batch add what the model reads',
    async run(rt) {
      const dir = path.join(rt.root, 'cc-hooks-e2e')
      const batch = { hookSpecificOutput: { additionalContext: 'BATCH-NOTE from PostToolBatch' } }
      writeTree(dir, {
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'cchk', version: '1.0.0' }),
        'commands/hello.md': '---\ndescription: Say hello\n---\nSay hello to $ARGUMENTS.\n',
        'hooks/hooks.json': JSON.stringify({
          hooks: {
            UserPromptExpansion: [
              {
                matcher: 'cchk:hello',
                hooks: [{ type: 'command', command: 'cat >/dev/null; echo EXPANSION-NOTE' }],
              },
            ],
            PostToolBatch: [
              {
                hooks: [
                  { type: 'command', command: `cat >/dev/null; echo '${JSON.stringify(batch)}'` },
                ],
              },
            ],
          },
        }),
      })
      await rt.api('/plugins/install', { source: dir, enable: true })

      const session = await rt.createSession({ title: 'Claude Code hooks' })
      const steps = { localix: [{ tool: 'bash', args: { command: 'ls' } }, 'Hello.'] }
      const after = await rt.say(session.id, `/cchk:hello world ${script(steps)}`)
      const [first, second] = runs(rt, after, 'localix')
      assert.ok(
        first.reminders.some((reminder) => reminder.includes('EXPANSION-NOTE')),
        'UserPromptExpansion context rode the expanded command',
      )
      assert.ok(
        second.reminders.some((reminder) => reminder.includes('BATCH-NOTE from PostToolBatch')),
        'PostToolBatch context reached the request after the batch',
      )
    },
  },
]
