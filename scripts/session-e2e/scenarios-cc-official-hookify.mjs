/** Session E2E: official marketplace plugins — hookify. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'
import {
  HOOKIFY_BLOCK_ENV,
  HOOKIFY_REQUIRE_TESTS,
  HOOKIFY_WARN_RM,
  invocation,
  read,
  spiedWrite,
  toolCalls,
  withPlugins,
} from './scenarios-cc-official-helpers.mjs'

export const CC_OFFICIAL_HOOKIFY_SCENARIOS = [
  {
    name: 'cc-official: hookify — /hookify:hookify expands with its arguments and loads its skill, and the rule it writes warns at once',
    async run(rt) {
      await withPlugins(rt, ['hookify'], {}, async ({ dir, session, notices }) => {
        const file = { path: '.claude/hookify.warn-rm.local.md', content: HOOKIFY_WARN_RM }
        const steps = {
          localix: [
            { tool: 'skill', args: { action: 'get', name: 'hookify:writing-rules' } },
            { tool: 'write', args: { files: [file] } },
            'Created the rule.',
          ],
        }
        const made = await rt.say(session.id, `/hookify:hookify Warn me on rm -rf ${script(steps)}`)
        const expanded = invocation(made)
        assert.ok(expanded.startsWith('# Hookify - Create Hooks'), expanded.slice(0, 200))
        // skills.md: "$ARGUMENTS — All arguments passed when invoking the skill."
        assert.match(expanded, /specific instructions: `Warn me on rm -rf/)
        assert.ok(!expanded.includes('$ARGUMENTS'), 'every placeholder is replaced')
        const [, second, third] = runs(rt, made, 'localix')
        // skills.md: plugin skills are "namespaced as /plugin-name:skill-name".
        assert.ok(read(second).includes('# Writing Hookify Rules'), read(second))
        assert.ok(third && existsSync(path.join(dir, file.path)), 'the rule file was written')

        // hookify.md: "Rules are active immediately - no restart needed!" Bypass mode, so no
        // permission prompt stands between the warning and the command.
        await rt.api(`/sessions/${session.id}`, { permissionMode: 'bypass' }, 'PATCH')
        const call = { tool: 'bash', args: { command: 'rm -rf ./build-cache && echo RM-RAN' } }
        const warned = await rt.say(session.id, `Clean up. ${script({ localix: [call, 'Done.'] })}`)
        // hookify README: "`warn`: Shows warning but allows operation (default)".
        assert.match(toolCalls(warned).at(-1).resultText, /RM-RAN/, 'the command still ran')
        // hooks.md: "systemMessage — Warning message shown to the user."
        assert.match(notices(), /WARN-RM-RULE/, 'the person sees the warning')
      })
    },
  },
  {
    name: 'cc-official: hookify — a block rule on file events refuses the Write, nothing is written and the model reads the rule',
    async run(rt) {
      await withPlugins(rt, ['hookify'], {}, async ({ dir, session, notices }) => {
        mkdirSync(path.join(dir, '.claude'), { recursive: true })
        writeFileSync(path.join(dir, '.claude/hookify.block-env.local.md'), HOOKIFY_BLOCK_ENV)
        const write = { files: [{ path: 'config/.env', content: 'API_KEY=1\n' }] }
        const steps = { localix: [{ tool: 'write', args: write }, 'Refused.'] }
        const after = await rt.say(session.id, `Store the key. ${script(steps)}`)
        // hooks.md: PreToolUse `"deny"` prevents the tool call.
        assert.ok(!existsSync(path.join(dir, 'config/.env')), 'the blocked Write did not run')
        // hookify README: "`block`: Prevents operation from executing (PreToolUse)", and its
        // rule text is the only reason it gives, so that is what the model reads.
        const [, second] = runs(rt, after, 'localix')
        assert.ok(read(second).includes('BLOCK-ENV-RULE'), read(second))
        // hooks.md: "systemMessage — Warning message shown to the user."
        assert.match(notices(), /BLOCK-ENV-RULE/)
      })
    },
  },
  {
    name: 'cc-official: hookify — its hooks run in the session folder and read a Write by Claude Code’s tool name and input',
    async run(rt) {
      await spiedWrite(rt, ({ dir, pre, post }) => {
        // hooks.md: "Handlers run in the current directory"; `cwd` — "Current working directory".
        assert.equal(realpathSync(pre.pwd), realpathSync(dir))
        assert.equal(pre.input.cwd, dir)
        // hooks.md (PreToolUse): `tool_name` is the tool's name, here "Write", with its input.
        for (const call of [pre, post]) {
          assert.equal(call.input.tool_name, 'Write')
          assert.equal(call.input.tool_input.content, 'Ship it.\n')
        }
      })
    },
  },
  {
    name: 'cc-official: hookify — its hooks get the session’s id as CLAUDE_CODE_SESSION_ID',
    async run(rt) {
      await spiedWrite(rt, ({ pre }) => {
        // env-vars.md: CLAUDE_CODE_SESSION_ID "matches the session_id field in the hook JSON input".
        assert.ok(pre.input.session_id, 'the input names the session')
        assert.equal(pre.env.CLAUDE_CODE_SESSION_ID, pre.input.session_id)
      })
    },
  },
  {
    name: 'cc-official: hookify — its hooks read a Write’s file_path absolute, before and after the call',
    async run(rt) {
      await spiedWrite(rt, ({ dir, pre, post }) => {
        // hooks.md (Write): "file_path — Absolute path to the file to write"; PostToolUse:
        // "File-tool tool_input paths arrive … always absolute".
        assert.equal(pre.input.tool_input.file_path, path.join(dir, 'notes/todo.md'))
        assert.equal(post.input.tool_input.file_path, path.join(dir, 'notes/todo.md'))
      })
    },
  },
  {
    name: 'cc-official: hookify — its Stop hook reads the last assistant message, and stop_hook_active false',
    async run(rt) {
      await withPlugins(rt, ['hookify'], { spy: ['Stop'] }, async ({ session, spy }) => {
        await rt.say(session.id, `Fix it. ${script({ localix: ['Finished.'] })}`)
        const [stop] = spy('Stop')
        // hooks.md (Stop): hooks receive "stop_hook_active, last_assistant_message"; the first is
        // "true when Claude Code is already continuing as a result of a stop hook".
        assert.equal(stop?.input.stop_hook_active, false, JSON.stringify(stop?.input))
        assert.equal(stop.input.last_assistant_message, 'Finished.')
      })
    },
  },
  {
    name: 'cc-official: hookify — its Stop hook gets a transcript_path to the conversation',
    async run(rt) {
      await withPlugins(rt, ['hookify'], { spy: ['Stop'] }, async ({ session, spy }) => {
        await rt.say(session.id, `Fix it. ${script({ localix: ['Finished.'] })}`)
        const [stop] = spy('Stop')
        // hooks.md: "transcript_path — Path to conversation JSON".
        const transcript = stop?.input.transcript_path
        assert.ok(transcript && existsSync(transcript), `transcript_path: ${transcript}`)
      })
    },
  },
  {
    name: 'cc-official: hookify — a stop rule on the transcript holds the turn open until the tests ran',
    async run(rt) {
      await withPlugins(rt, ['hookify'], { spy: ['Stop'] }, async ({ dir, session, spy }) => {
        mkdirSync(path.join(dir, '.claude'), { recursive: true })
        writeFileSync(
          path.join(dir, '.claude/hookify.require-tests.local.md'),
          HOOKIFY_REQUIRE_TESTS,
        )
        // The tests' output (`npm test 42`) appears only once the command has run.
        const test = { tool: 'bash', args: { command: 'echo npm test $((6*7))' } }
        const steps = { localix: ['Finished.', test, 'Tests ran.'] }
        const after = await rt.say(session.id, `Fix it. ${script(steps)}`)
        // hooks.md (Stop): `"block"` prevents Claude from stopping; `reason` "Tells Claude why".
        const turn = runs(rt, after, 'localix')
        assert.equal(turn.length, 3, 'blocked once, then let through after the tests ran')
        assert.ok(read(turn[1]).includes('REQUIRE-TESTS-RULE'), read(turn[1]))
        // hooks.md (Stop): `stop_hook_active` is "true when Claude Code is already continuing as
        // a result of a stop hook".
        assert.deepEqual(
          spy('Stop').map((call) => call.input.stop_hook_active),
          [false, true],
        )
      })
    },
  },
]
