/** Session E2E: what a Claude Code plugin's output styles and default settings do to a run. */
import assert from 'node:assert/strict'

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { lastRun, script } from './scenario-helpers.mjs'

const VERIFY_LINE = 'Complete your part of the requested outcome'

/** Install a plugin folder written from `files`, run `body`, and remove the plugin again. */
async function withPlugin(rt, name, files, body) {
  const dir = path.join(rt.root, name)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  await rt.api('/plugins/install', { source: dir, enable: true })
  try {
    await body()
  } finally {
    // Later scenarios share this API: a default agent left enabled would answer for them.
    await rt.api('/plugins/remove', { name })
  }
}

const manifest = (name) => JSON.stringify({ name, version: '1.0.0' })

export const PLUGIN_SCENARIOS = [
  {
    name: 'plugins: /output-style switches the chat to a plugin style and back',
    async run(rt) {
      await withPlugin(
        rt,
        'house-style',
        {
          '.claude-plugin/plugin.json': manifest('house-style'),
          'output-styles/terse.md':
            '---\nname: terse\ndescription: One-line answers\n---\n\nAnswer in one line.\n',
        },
        async () => {
          const session = await rt.createSession({ title: 'Output style' })
          const set = await rt.say(session.id, '/output-style terse')
          assert.match(rt.transcript(set).at(-1).text, /set to `house-style:terse`/)

          const styled = await rt.say(session.id, `Hi. ${script({ localix: ['Hi.'] })}`)
          const { system } = lastRun(rt, styled)
          assert.ok(system.includes('# Output style'), 'the style rides the system prompt')
          assert.ok(system.includes('Answer in one line.'))
          assert.ok(!system.includes(VERIFY_LINE), 'without keep-coding-instructions')

          await rt.say(session.id, '/output-style default')
          const plain = await rt.say(session.id, `Again. ${script({ localix: ['Again.'] })}`)
          assert.ok(!lastRun(rt, plain).system.includes('# Output style'))
          assert.ok(lastRun(rt, plain).system.includes(VERIFY_LINE))
        },
      )
    },
  },
  {
    name: 'plugins: the person’s default output style, a built-in and their own style reach the prompt',
    async run(rt) {
      const styles = path.join(rt.root, 'home', '.localix', 'output-styles')
      mkdirSync(styles, { recursive: true })
      writeFileSync(
        path.join(styles, 'pirate.md'),
        '---\ndescription: Arr\n---\n\nSpeak like a pirate.\n',
      )
      await rt.api('/user/profile', { agentSettingsPatch: { outputStyle: 'Explanatory' } }, 'PATCH')
      try {
        const session = await rt.createSession({ title: 'Default style' })
        const first = await rt.say(session.id, `Hi. ${script({ localix: ['Hi.'] })}`)
        const system = lastRun(rt, first).system
        assert.ok(system.includes('uses the "Explanatory" output style'), 'the default applies')
        assert.ok(system.includes('★ Insight'))
        assert.ok(system.includes(VERIFY_LINE), 'a built-in style keeps the coding instructions')

        const set = await rt.say(session.id, '/output-style PIRATE')
        assert.match(rt.transcript(set).at(-1).text, /set to `pirate`/)
        const own = await rt.say(session.id, `Again. ${script({ localix: ['Again.'] })}`)
        assert.ok(lastRun(rt, own).system.includes('Speak like a pirate.'))

        await rt.say(session.id, '/output-style default')
        const plain = await rt.say(session.id, `Plain. ${script({ localix: ['Plain.'] })}`)
        assert.ok(!lastRun(rt, plain).system.includes('# Output style'), '`default` opts out')
      } finally {
        await rt.api('/user/profile', { agentSettingsPatch: { outputStyle: null } }, 'PATCH')
      }
    },
  },
  {
    name: 'plugins: a plugin’s settings.json agent runs the default chat as that agent',
    async run(rt) {
      await withPlugin(
        rt,
        'sec-review',
        {
          '.claude-plugin/plugin.json': manifest('sec-review'),
          'agents/security-reviewer.md':
            '---\nname: security-reviewer\ndescription: Reviews code\ntools: Read, Grep\n---\n\nYou are the security reviewer.\n',
          'settings.json': JSON.stringify({ agent: 'security-reviewer' }),
        },
        async () => {
          const session = await rt.createSession({ title: 'Default agent' })
          const after = await rt.say(session.id, `Review. ${script({ localix: ['Reviewed.'] })}`)
          const run = lastRun(rt, after)
          assert.ok(run.system.includes('You are the security reviewer.'))
          assert.ok(run.tools.includes('read'), 'its tools stay')
          assert.ok(!run.tools.includes('bash'), 'a tool its list leaves out is off')
        },
      )
      const later = await rt.createSession({ title: 'After removal' })
      const after = await rt.say(later.id, `Hello. ${script({ localix: ['Hello.'] })}`)
      assert.ok(!lastRun(rt, after).system.includes('You are the security reviewer.'))
    },
  },
  {
    name: 'plugins: the settings.json agent’s model runs the chat unless the person picked one',
    async run(rt) {
      await withPlugin(
        rt,
        'quick-agent',
        {
          '.claude-plugin/plugin.json': manifest('quick-agent'),
          'agents/quick.md':
            '---\nname: quick\ndescription: Answers fast\nmodel: gpt-4o-mini\n---\n\nYou answer quickly.\n',
          'settings.json': JSON.stringify({ agent: 'quick' }),
        },
        async () => {
          // The person picks this chat's model: the plugin agent keeps it.
          const picked = await rt.createSession({ title: 'Picked model' })
          const kept = await rt.say(picked.id, `Hi. ${script({ localix: ['Hi.'] })}`)
          assert.equal(lastRun(rt, kept).model, 'gpt-4o')

          // A chat whose seat took a default (the last model used) runs on the agent's model.
          const born = await rt.api('/sessions', {
            title: 'Default model',
            agentIds: [rt.agentIds.localix],
          })
          const after = await rt.say(born.id, `Hello. ${script({ localix: ['Hello.'] })}`)
          const run = lastRun(rt, after)
          assert.ok(run.system.includes('You answer quickly.'))
          assert.equal(run.model, 'gpt-4o-mini')
          const seat = (await rt.detail(born.id)).agents[0]
          assert.equal(seat.modelId, 'gpt-4o-mini', 'the seat shows what the chat runs on')
        },
      )
    },
  },
]
