/** Session E2E: Claude Code hooks that change what the person sees, never what the model reads. */
import assert from 'node:assert/strict'

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { lastRun, script } from './scenario-helpers.mjs'

function writeTree(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
}

export const HOOK_SCENARIOS = [
  {
    name: 'claude code hooks: MessageDisplay changes the shown reply, and the model reads the original',
    async run(rt) {
      const dir = path.join(rt.root, 'cc-display-e2e')
      const shown = {
        hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: 'SHOWN-BY-HOOK' },
      }
      writeTree(dir, {
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'ccdisplay', version: '1.0.0' }),
        'hooks/hooks.json': JSON.stringify({
          hooks: {
            MessageDisplay: [
              {
                hooks: [
                  { type: 'command', command: `cat >/dev/null; echo '${JSON.stringify(shown)}'` },
                ],
              },
            ],
          },
        }),
      })
      await rt.api('/plugins/install', { source: dir, enable: true })

      const session = await rt.createSession({ title: 'MessageDisplay' })
      const first = await rt.say(session.id, `Answer. ${script({ localix: ['ORIGINAL-REPLY'] })}`)
      const reply = first.messages.at(-1).payload
      // The stored reply keeps the model's words; the shown text rides beside it.
      assert.equal(reply.content, 'ORIGINAL-REPLY')
      assert.deepEqual(Object.values(reply.displayTexts ?? {}), ['SHOWN-BY-HOOK'])

      const second = await rt.say(session.id, 'And again?')
      const read = lastRun(rt, second)
        .messages.map((message) => message.text)
        .join('\n')
      assert.ok(read.includes('ORIGINAL-REPLY'), 'the next turn reads the original reply')
      assert.ok(!read.includes('SHOWN-BY-HOOK'), 'the shown text never reaches the model')
    },
  },
]
