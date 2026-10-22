/** Session E2E: Claude Code session hooks — SessionStart, UserPromptSubmit and UserPromptExpansion. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'
import {
  chat,
  context,
  emit,
  hookPlugin,
  reads,
  shown,
} from './scenarios-cc-session-hooks-helpers.mjs'

export const CC_SESSION_HOOK_START_PROMPT_SCENARIOS = [
  {
    name: 'cc-session-hooks: SessionStart fires once with source startup, its JSON and plain-stdout context stay in the conversation, and it gets the plugin env',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-start')
        .on('SessionStart', 'json', emit(context('SessionStart', 'SS-JSON')), {
          matcher: 'startup',
        })
        .on('SessionStart', 'plain', 'echo SS-PLAIN')
        .on('SessionStart', 'resume', 'echo SS-RESUME', { matcher: 'resume' })
      await p.run(async () => {
        const session = await chat(rt, 'SessionStart', [
          `Hi. ${script({ localix: ['Hello.'] })}`,
          `Again. ${script({ localix: ['Again.'] })}`,
        ])
        // "`startup` | New session"; a `resume` matcher does not match it.
        assert.equal(p.seen('json').length, 1, 'SessionStart fires once per session, not per turn')
        assert.equal(p.seen('resume').length, 0)
        const [input] = p.seen('json')
        assert.equal(input.hook_event_name, 'SessionStart')
        assert.equal(input.source, 'startup')
        assert.ok(input.session_id && input.cwd, JSON.stringify(input))
        // "additionalContext | String added to Claude's context at the start of the conversation";
        // "Claude Code adds a SessionStart hook's plain-text stdout to Claude's context."
        const requests = runs(rt, session, 'localix')
        assert.equal(requests.length, 2, 'each turn asked the model once')
        for (const request of requests) {
          assert.ok(reads(request).includes('SS-JSON'), reads(request))
          assert.ok(reads(request).includes('SS-PLAIN'))
        }
        // "export them as the environment variables CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, and
        // CLAUDE_PLUGIN_DATA on the spawned process".
        const env = p.env('json')
        assert.ok(env.CLAUDE_PROJECT_DIR && env.CLAUDE_PLUGIN_DATA)
        assert.ok(existsSync(path.join(env.CLAUDE_PLUGIN_ROOT, 'hooks', 'hooks.json')))
      })
    },
  },
  {
    name: 'cc-session-hooks: SessionStart CLAUDE_ENV_FILE exports reach later Bash commands',
    async run(rt) {
      const write = `echo 'export CCS_PROBE=env-file-ok' >> "$CLAUDE_ENV_FILE"`
      const p = hookPlugin(rt, 'ccs-start-env').on(
        'SessionStart',
        'start',
        `[ -n "$CLAUDE_ENV_FILE" ] && ${write}`,
      )
      await p.run(async () => {
        const steps = [{ tool: 'bash', args: { command: 'echo "probe=$CCS_PROBE"' } }, 'Ok.']
        const session = await chat(rt, 'Start env', [`Probe. ${script({ localix: steps })}`])
        // "SessionStart hooks have access to the CLAUDE_ENV_FILE environment variable … persist
        // environment variables for the shell commands Claude runs later in the session."
        assert.ok(p.env('start').CLAUDE_ENV_FILE, 'the hook got no CLAUDE_ENV_FILE')
        const afterBash = runs(rt, session, 'localix')[1]
        assert.ok(afterBash, 'the model was asked again after the Bash call')
        assert.ok(reads(afterBash).includes('probe=env-file-ok'), reads(afterBash))
      })
    },
  },
  {
    name: 'cc-session-hooks: a SessionStart sessionTitle names the session',
    async run(rt) {
      const title = { hookSpecificOutput: { hookEventName: 'SessionStart', sessionTitle: 'CCS-T' } }
      // "If your plugin's SessionStart hook supplies … sessionTitle, install the plugin before the
      // session starts": it is installed before the chat is created.
      const p = hookPlugin(rt, 'ccs-start-title').on('SessionStart', 'start', emit(title))
      await p.run(async () => {
        const session = await chat(rt, 'Start title', [`Hi. ${script({ localix: ['Hello.'] })}`])
        assert.equal(p.seen('start').length, 1)
        // "sessionTitle | Sets the session title, with the same effect as /rename".
        assert.equal(session.title, 'CCS-T')
      })
    },
  },
  {
    name: 'cc-session-hooks: UserPromptSubmit reads the prompt; its additionalContext and plain stdout reach the model, not the transcript, and cannot replace the prompt',
    async run(rt) {
      // "UserPromptSubmit: can't replace the prompt; it only injects additionalContext".
      const out = { ...context('UserPromptSubmit', 'UPS-JSON'), updatedInput: { prompt: 'UPS-X' } }
      const p = hookPlugin(rt, 'ccs-ups')
        .on('UserPromptSubmit', 'json', emit(out))
        .on('UserPromptSubmit', 'plain', 'echo UPS-PLAIN')
      await p.run(async () => {
        const prompt = `Write the factorial. ${script({ localix: ['Written.'] })}`
        const session = await chat(rt, 'UserPromptSubmit', [prompt])
        const [input] = p.seen('json')
        assert.equal(input.hook_event_name, 'UserPromptSubmit')
        assert.equal(input.prompt, prompt, 'the hook reads the prompt as typed')
        // "two ways to add context … Plain text stdout … JSON with additionalContext".
        const read = reads(runs(rt, session, 'localix')[0])
        assert.ok(read.includes('UPS-JSON') && read.includes('UPS-PLAIN'), read)
        assert.ok(read.includes('Write the factorial.') && !read.includes('UPS-X'))
        // "Neither channel produces a visible transcript entry."
        const visible = rt
          .transcript(session)
          .map((row) => row.text)
          .join('\n')
        assert.ok(!visible.includes('UPS-JSON') && !visible.includes('UPS-PLAIN'), visible)
      })
    },
  },
  {
    name: 'cc-session-hooks: UserPromptSubmit decision block and exit 2 stop the prompt before the model and show the reason',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-block').on(
        'UserPromptSubmit',
        'gate',
        [
          'case "$input" in',
          `  *BY-JSON*) ${emit({ decision: 'block', reason: 'UPS-JSON-REASON' })} ;;`,
          "  *BY-EXIT*) echo 'UPS-EXIT-REASON' >&2; exit 2 ;;",
          'esac',
        ].join('\n'),
      )
      await p.run(async () => {
        // "decision | "block" stops the prompt before it reaches Claude"; "reason | Shown to the
        // user"; exit 2: "the block message shows the stderr text to the user".
        const session = await rt.createSession({ title: 'Blocked prompt' })
        for (const [prompt, reason] of [
          ['BY-JSON', 'UPS-JSON-REASON'],
          ['BY-EXIT', 'UPS-EXIT-REASON'],
        ]) {
          const after = await rt.say(session.id, `${prompt} ${script({ localix: ['NO.'] })}`)
          assert.equal(runs(rt, session, 'localix').length, 0, 'the model got no request')
          assert.ok(shown(after).includes(reason), shown(after))
        }
        assert.equal(p.seen('gate').length, 2)
      })
    },
  },
  {
    name: 'cc-session-hooks: a blocked prompt and its reason never reach the model on later turns',
    async run(rt) {
      const block = emit({ decision: 'block', reason: 'UPS-HIDDEN' })
      const p = hookPlugin(rt, 'ccs-block-later').on(
        'UserPromptSubmit',
        'gate',
        `case "$input" in *SECRET-PROMPT*) ${block} ;; esac`,
      )
      await p.run(async () => {
        const session = await chat(rt, 'Blocked, later', [
          'SECRET-PROMPT do it',
          `Fine now. ${script({ localix: ['Answered.'] })}`,
        ])
        // "A blocked prompt never reaches Claude"; its reason is "Not added to context".
        const [later] = runs(rt, session, 'localix')
        assert.ok(later, 'turn 2 reached the model')
        const read = reads(later)
        assert.ok(read.includes('Fine now.'), read)
        assert.ok(!read.includes('SECRET-PROMPT') && !read.includes('UPS-HIDDEN'), read)
      })
    },
  },
  {
    name: 'cc-session-hooks: UserPromptExpansion reads the typed command and a block stops its expansion',
    async run(rt) {
      const block = emit({ decision: 'block', reason: 'EXP-NO-PROD' })
      const p = hookPlugin(rt, 'ccs-exp')
        .file('commands/deploy.md', '---\ndescription: Deploy\n---\nDeploy to $ARGUMENTS.\n')
        .on(
          'UserPromptExpansion',
          'exp',
          `case "$input" in *'"command_args":"prod'*) ${block} ;; esac`,
        )
      await p.run(async () => {
        const session = await rt.createSession({ title: 'Expansion' })
        await rt.say(session.id, `/ccs-exp:deploy staging ${script({ localix: ['Deployed.'] })}`)
        assert.equal(runs(rt, session, 'localix').length, 1)
        // "receive expansion_type, command_name, command_args, command_source, and the original
        // prompt string. The expansion_type field is slash_command for skill and custom commands".
        const [input] = p.seen('exp')
        assert.equal(input.hook_event_name, 'UserPromptExpansion')
        assert.equal(input.expansion_type, 'slash_command')
        assert.match(input.command_name, /deploy$/)
        assert.match(input.command_args, /^staging/)
        assert.equal(input.command_source, 'plugin')
        assert.match(input.prompt, /^\/ccs-exp:deploy staging/)
        // "decision | "block" prevents the command from expanding"; reason "Shown to the user".
        const blocked = await rt.say(session.id, '/ccs-exp:deploy prod')
        assert.equal(runs(rt, session, 'localix').length, 1, 'the blocked command never ran')
        assert.ok(shown(blocked).includes('EXP-NO-PROD'), shown(blocked))
      })
    },
  },
]
