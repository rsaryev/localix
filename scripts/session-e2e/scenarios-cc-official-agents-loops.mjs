/** Session E2E: official marketplace plugins — pr-review-toolkit, ralph-loop, output styles, plugin-dev. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'
import {
  childRun,
  delegateTo,
  invocation,
  read,
  toolCalls,
  withPlugins,
} from './scenarios-cc-official-helpers.mjs'

export const CC_OFFICIAL_AGENT_LOOP_SCENARIOS = [
  {
    name: 'cc-official: pr-review-toolkit — its six agents each run as a delegated type by scoped name, with their prompts, inheriting every tool',
    async run(rt) {
      await withPlugins(rt, ['pr-review-toolkit'], {}, async ({ session }) => {
        const prompts = {
          'code-reviewer': 'You are an expert code reviewer specializing in modern software',
          'code-simplifier': 'You are an expert code simplification specialist',
          'comment-analyzer': 'You are a meticulous code comment analyzer',
          'pr-test-analyzer': 'You are an expert test coverage analyst',
          'silent-failure-hunter': 'You are an elite error handling auditor',
          'type-design-analyzer': 'You are a type design expert',
        }
        const agents = Object.keys(prompts)
        const steps = {
          localix: [...agents.map((a) => delegateTo(`pr-review-toolkit:${a}`, `${a}-DONE`)), 'Ok.'],
        }
        const after = await rt.say(session.id, `Review the PR. ${script(steps)}`, {
          timeoutMs: 180_000,
        })
        // Sent only when an enabled plugin offers agents (see feature-dev above).
        assert.ok(runs(rt, after, 'localix')[0].contextHeadings.includes('# Agent types'))
        for (const agent of agents) {
          const child = childRun(rt, `${agent}-DONE`)
          // plugins-reference.md: plugin agents are scoped as `<plugin>:<agent>`.
          assert.ok(child, `pr-review-toolkit:${agent} never ran`)
          assert.ok(child.system.includes(prompts[agent]), `${agent} runs with its prompt`)
          // sub-agents.md: `tools` — "Inherits all tools if omitted"; none of these lists any.
          for (const tool of ['bash', 'read', 'write', 'edit'])
            assert.ok(child.tools.includes(tool), `${agent} lacks ${tool}`)
        }
      })
    },
  },
  {
    name: 'cc-official: ralph-loop — /ralph-loop:ralph-loop runs its setup script with the arguments, and its Stop hook ends the loop at --max-iterations',
    async run(rt) {
      await withPlugins(rt, ['ralph-loop'], {}, async ({ dir, session }) => {
        // The script rides an earlier message: the command's arguments reach a shell.
        const replies = ['Ready.', 'Pass one.', 'Pass two.']
        const ready = await rt.say(session.id, `Get ready. ${script({ localix: replies })}`)
        const before = runs(rt, ready, 'localix').length
        const after = await rt.say(
          session.id,
          '/ralph-loop:ralph-loop Polish the README --max-iterations 1',
        )
        // skills.md: a ```! block runs "before the skill content is sent to Claude", and
        // "$ARGUMENTS — All arguments passed when invoking the skill". The script prints the
        // prompt it parsed and the iteration cap.
        const expanded = invocation(after)
        assert.match(expanded, /Ralph loop activated in this session![\s\S]*Max iterations: 1\n/)
        assert.match(expanded, /\nPolish the README\n/)
        // The state file records CLAUDE_CODE_SESSION_ID, which env-vars.md sets in Bash tool
        // subprocesses (skills.md: injected commands run "through the Bash tool") and hooks alike.
        // ralph's Stop hook acts only on its own session's loop, and at the cap it removes the
        // state and lets the turn end: one answer, no file left.
        const turn = runs(rt, after, 'localix').slice(before)
        assert.deepEqual(
          turn.map((request) => request.answered.text),
          ['Pass one.'],
        )
        assert.ok(!existsSync(path.join(dir, '.claude/ralph-loop.local.md')), 'the loop ended')
      })
    },
  },
  {
    name: 'cc-official: ralph-loop — its Stop hook reads the transcript, feeds the prompt back, and ends the loop at the completion promise',
    async run(rt) {
      await withPlugins(rt, ['ralph-loop'], {}, async ({ dir, session }) => {
        const replies = ['Ready.', 'Pass one.', 'Pass two. <promise>DONE</promise>', 'Pass three.']
        const ready = await rt.say(session.id, `Get ready. ${script({ localix: replies })}`)
        const before = runs(rt, ready, 'localix').length
        const after = await rt.say(
          session.id,
          '/ralph-loop:ralph-loop Polish the README --max-iterations 5 --completion-promise DONE',
        )
        // ralph's Stop hook takes the last assistant text out of transcript_path ("grep
        // '"role":"assistant"' … jq '.message.content[] | select(.type == "text")'"): without the
        // promise it blocks with the prompt as the reason, so the agent goes again; with it, the
        // loop ends and the state file goes.
        const turn = runs(rt, after, 'localix').slice(before)
        assert.deepEqual(
          turn.map((request) => request.answered.text),
          ['Pass one.', 'Pass two. <promise>DONE</promise>'],
        )
        assert.ok(!existsSync(path.join(dir, '.claude/ralph-loop.local.md')), 'the loop ended')
      })
    },
  },
  {
    name: 'cc-official: ralph-loop — a setup script that fails aborts /ralph-loop:ralph-loop before the model is asked',
    async run(rt) {
      await withPlugins(rt, ['ralph-loop'], {}, async ({ dir, session }) => {
        // With no prompt the setup script exits 1: "❌ Error: No prompt provided".
        const after = await rt.say(session.id, '/ralph-loop:ralph-loop')
        // skills.md: "A failed command aborts the entire skill invocation … Claude never sees the
        // skill content for that invocation. … The error message includes the command's output."
        assert.equal(runs(rt, after, 'localix').length, 0, 'the model was not asked')
        assert.ok(!existsSync(path.join(dir, '.claude/ralph-loop.local.md')), 'no loop started')
        const shown = [
          ...rt.transcript(after).map((row) => row.text),
          ...rt.notices(after).map((n) => n.text),
        ]
        assert.ok(
          shown.some((text) => text.includes('No prompt provided')),
          JSON.stringify(shown),
        )
      })
    },
  },
  {
    name: 'cc-official: ralph-loop — /ralph-loop:cancel-ralph expands to its steps',
    async run(rt) {
      await withPlugins(rt, ['ralph-loop'], {}, async ({ session }) => {
        const reply = 'No active Ralph loop found.'
        const after = await rt.say(
          session.id,
          `/ralph-loop:cancel-ralph ${script({ localix: [reply] })}`,
        )
        // The command is instructions for Claude: what the model receives is the whole of it.
        const expanded = invocation(after)
        assert.match(expanded, /^# Cancel Ralph/)
        assert.ok(
          expanded.includes(
            'test -f .claude/ralph-loop.local.md && echo "EXISTS" || echo "NOT_FOUND"',
          ),
          expanded,
        )
        assert.ok(expanded.includes('rm .claude/ralph-loop.local.md'), expanded)
        assert.equal(rt.transcript(after).at(-1).text, reply)
      })
    },
  },
  {
    name: 'cc-official: explanatory and learning output styles — their SessionStart context reaches the model before the first prompt, once',
    async run(rt) {
      const plugins = ['explanatory-output-style', 'learning-output-style']
      await withPlugins(rt, plugins, { spy: ['SessionStart'] }, async ({ session, spy }) => {
        await rt.say(session.id, `Hi. ${script({ localix: ['Hi.'] })}`)
        const after = await rt.say(session.id, `Again. ${script({ localix: ['Again.'] })}`)
        const [first, second] = runs(rt, after, 'localix')
        const styles = [
          "You are in 'explanatory' output style mode",
          "You are in 'learning' output style mode",
        ]
        // hooks.md (SessionStart): `additionalContext` — "String added to Claude's context at the
        // start of the conversation, before the first prompt", wrapped in a system reminder.
        for (const style of styles) {
          assert.equal(first.reminders.filter((r) => r.includes(style)).length, 1, style)
          assert.equal(
            second.reminders.filter((r) => r.includes(style)).length,
            1,
            `${style} again`,
          )
        }
        // hooks.md: SessionStart's `source` is "startup" for a new session; it runs once.
        assert.deepEqual(
          spy('SessionStart').map((call) => call.input.source),
          ['startup'],
        )
      })
    },
  },
  {
    name: 'cc-official: plugin-dev and skill-creator — their skills are listed and load by namespaced name',
    async run(rt) {
      await withPlugins(rt, ['plugin-dev', 'skill-creator'], {}, async ({ session }) => {
        const get = (name) => ({ tool: 'skill', args: { action: 'get', name } })
        const steps = {
          localix: [
            get('plugin-dev:hook-development'),
            get('skill-creator:skill-creator'),
            'Loaded.',
          ],
        }
        const after = await rt.say(session.id, `Load them. ${script(steps)}`)
        const [first, , third] = runs(rt, after, 'localix')
        // skills.md: plugin skills are "namespaced as /plugin-name:skill-name", and Claude sees
        // each skill's description to decide when to load it.
        for (const name of ['plugin-dev:hook-development', 'skill-creator:skill-creator'])
          assert.ok(first.system.includes(name) || read(first).includes(name), `${name} is listed`)
        const [hook, creator] = toolCalls(after)
        assert.ok(hook.resultText.includes('# Hook Development for Claude Code Plugins'))
        assert.ok(creator.resultText.includes('# Skill Creator'))
        assert.ok(third, 'both loaded and the turn went on')
      })
    },
  },
]
