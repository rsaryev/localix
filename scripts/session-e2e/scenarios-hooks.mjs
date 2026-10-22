/** Session E2E: Claude Code hooks — what the person sees, and the call a hook script reads. */
import assert from 'node:assert/strict'

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { lastRun, runs, script } from './scenario-helpers.mjs'

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
  {
    name: 'claude code hooks: a PreToolUse script reads Bash in Claude Code’s shape and denies rm -rf',
    async run(rt) {
      const dir = path.join(rt.root, 'cc-pretool-e2e')
      const deny = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'RM-RF-GUARD refused it',
        },
      }
      // As hookify does: the script tests `tool_name == "Bash"` and reads `tool_input.command`.
      const guard = [
        'input=$(cat)',
        'case "$input" in',
        `  *'"tool_name":"Bash"'*'"command":"rm -rf'*) echo '${JSON.stringify(deny)}' ;;`,
        'esac',
      ].join('\n')
      writeTree(dir, {
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'ccpretool', version: '1.0.0' }),
        'hooks/guard.sh': guard,
        'hooks/hooks.json': JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'sh "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh"' }],
              },
            ],
          },
        }),
      })
      await rt.api('/plugins/install', { source: dir, enable: true })
      try {
        const session = await rt.createSession({ title: 'PreToolUse guard' })
        const call = { tool: 'bash', args: { command: 'rm -rf ./nothing-here' } }
        const after = await rt.say(session.id, `Clean up. ${script({ localix: [call, 'Done.'] })}`)
        const [, second] = runs(rt, after, 'localix')
        assert.ok(second, 'the turn made a second model request')
        const read = second.messages.map((message) => message.text).join('\n')
        assert.ok(read.includes('RM-RF-GUARD refused it'), `the hook denied the call: ${read}`)
      } finally {
        await rt.api('/plugins/remove', { name: 'ccpretool' })
      }
    },
  },
]
