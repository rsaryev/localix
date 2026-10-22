/** Session E2E: a Claude Code plugin's agents as subagent types `delegate` runs a task as. */
import assert from 'node:assert/strict'

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { lastRun, script } from './scenario-helpers.mjs'

const REVIEWER = [
  '---',
  'name: reviewer',
  'description: Reviews code for security issues. Use after auth changes.',
  'tools: Read, Grep',
  'model: gpt-4o-mini',
  'maxTurns: 3',
  '---',
  '',
  'You are the plugin security reviewer.',
  '',
].join('\n')

export const PLUGIN_AGENT_SCENARIOS = [
  {
    name: 'plugins: the agent delegates to a plugin agent type, which runs with its prompt and tools',
    async run(rt) {
      const dir = path.join(rt.root, 'sec-kit')
      for (const [file, text] of Object.entries({
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'sec-kit', version: '1.0.0' }),
        'agents/reviewer.md': REVIEWER,
      })) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        writeFileSync(path.join(dir, file), text)
      }
      await rt.api('/plugins/install', { source: dir, enable: true })
      try {
        const session = await rt.createSession({ title: 'Plugin agent' })
        const childTask = `Review the login handler. ${script({ localix: ['No issues found.'] })}`
        const steps = {
          localix: [
            {
              tool: 'delegate',
              args: { task: childTask, title: 'Review', agent: 'sec-kit:reviewer', wait: true },
            },
            'The reviewer found nothing.',
          ],
        }
        const after = await rt.say(session.id, `Review the auth change. ${script(steps)}`, {
          timeoutMs: 90_000,
        })
        const parentRef = `LOCALIX-${after.seq}`
        const parent = rt
          .requests({ session: after, speaker: 'localix' })
          .find((request) => request.stream)
        assert.ok(parent.contextHeadings.includes('# Agent types'), 'the types are listed')
        assert.ok(!parent.system.includes('# Agent types'), 'not in the cached prompt')

        const child = rt
          .requests({ speaker: 'localix' })
          .find(
            (request) =>
              request.stream &&
              request.sessionId !== parentRef &&
              request.answered.text === 'No issues found.',
          )
        assert.ok(child, 'the plugin agent never ran')
        assert.ok(child.system.includes('You are the plugin security reviewer.'), 'its prompt')
        assert.ok(child.tools.includes('read'), 'a tool its list names stays')
        assert.ok(!child.tools.includes('bash'), 'a tool its list leaves out is off')
        assert.equal(child.model, 'gpt-4o-mini', 'its model')
        assert.ok(!child.contextHeadings.includes('# Agent types'), 'a child cannot delegate')
        assert.equal(lastRun(rt, after).answered.text, 'The reviewer found nothing.')
        assert.equal(rt.transcript(after).at(-1).text, 'The reviewer found nothing.')
      } finally {
        await rt.api('/plugins/remove', { name: 'sec-kit' })
      }
    },
  },
]
