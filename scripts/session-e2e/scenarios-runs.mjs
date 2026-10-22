/** Session E2E: what else a run inherits — commands, forks, permission modes, delegation. */
import assert from 'node:assert/strict'

import { lastRun, runs, script } from './scenario-helpers.mjs'

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
    name: 'codemode: the prompt prefers a script for dependent calls, and the script runs its tools',
    async run(rt) {
      const session = await rt.createSession({ title: 'Codemode' })
      const code =
        "const out = await tools.bash({ command: 'echo scripted-ok' }); return out.trim()"
      const steps = {
        localix: [{ tool: 'codemode', args: { code } }, 'The script reported scripted-ok.'],
      }
      const after = await rt.say(session.id, `Run a script. ${script(steps)}`)
      const [first, ...rest] = runs(rt, after, 'localix')
      assert.ok(first.tools.includes('codemode'), 'codemode is not on the roster')
      assert.ok(first.system.includes('Prefer one `codemode` script to a turn per call'))
      const answered = rest.at(-1)
      assert.ok(answered, 'the model never read the script result')
      assert.ok(
        answered.messages.some((message) => message.text.includes('scripted-ok')),
        'the script result did not reach the model',
      )
      assert.equal(rt.transcript(after).at(-1).text, 'The script reported scripted-ok.')
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
]
