/** Session E2E: a Claude Code mod (a hooks module) changing what the model receives in a turn. */
import assert from 'node:assert/strict'

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'

/**
 * `prompt.compose` adds a section to the system prompt, `tool.check` refuses the shell before it
 * runs (the model reads the reason as the tool's result), and `turn.step` sends the request that
 * follows the tool call on another model.
 */
const REGISTER = `
export function register(on) {
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'e2e-mod:policy', text: '# Mod policy\\nE2E-MOD-POLICY', scope: 'session' }] }
  })
  on('tool.check', { tool: 'Bash' }, () => ({ decision: 'deny', reason: 'E2E-MOD-DENIED: no shell here' }))
  on('turn.step', ($, e, next) => (e.index === 1 ? next({ ...e, model: 'gpt-4o-mini' }) : next(e)))
}
`

function writeTree(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
}

/** The mods host reloads after a plugin change, debounced: wait until it loaded this one. */
async function untilLoaded(rt, name) {
  const deadline = Date.now() + 15_000
  for (;;) {
    const { mods, failures } = await rt.api('/mods')
    if (mods.includes(name)) return
    assert.ok(!failures?.[name], `the mod did not load: ${failures?.[name]}`)
    assert.ok(Date.now() < deadline, `the mod ${name} never loaded`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

export const MOD_SCENARIOS = [
  {
    name: 'mods: prompt.compose, tool.check and turn.step change what the model receives',
    async run(rt) {
      const name = 'e2e-mod'
      const dir = path.join(rt.root, name)
      writeTree(dir, {
        '.claude-plugin/plugin.json': JSON.stringify({ name, version: '1.0.0' }),
        'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),
        'hooks/register.js': REGISTER,
      })
      await rt.api('/plugins/install', { source: dir, enable: true })
      try {
        await untilLoaded(rt, name)
        const session = await rt.createSession({ title: 'Mods' })
        const steps = { localix: [{ tool: 'bash', args: { command: 'ls' } }, 'Shell refused.'] }
        await rt.say(session.id, `List the files. ${script(steps)}`)
        const [first, second] = runs(rt, session)
        assert.ok(first && second, 'the turn made two model requests')
        assert.ok(first.system.includes('E2E-MOD-POLICY'), 'prompt.compose added its section')
        assert.ok(second.system.includes('E2E-MOD-POLICY'), 'the section stays: the prompt is kept')
        const read = second.messages.map((message) => message.text).join('\n')
        assert.ok(read.includes('E2E-MOD-DENIED'), 'tool.check refused the shell call')
        assert.notEqual(first.model, 'gpt-4o-mini')
        assert.equal(second.model, 'gpt-4o-mini', 'turn.step sent the second request elsewhere')
      } finally {
        await rt.api('/plugins/remove', { name })
      }
    },
  },
]
