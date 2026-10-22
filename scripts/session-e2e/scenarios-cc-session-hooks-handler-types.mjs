/** Session E2E: Claude Code session hooks — http, prompt, agent and async hooks, and once. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { runs, script } from './scenario-helpers.mjs'
import { until } from './scenarios-cc-helpers.mjs'
import {
  chat,
  childRuns,
  context,
  emit,
  hookPlugin,
  reads,
  shown,
} from './scenarios-cc-session-hooks-helpers.mjs'

export const CC_SESSION_HOOK_HANDLER_TYPE_SCENARIOS = [
  {
    name: 'cc-session-hooks: an http hook gets the event as a JSON POST and its response adds context; SessionStart skips http',
    async run(rt) {
      const posts = []
      const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(request) {
          const body = await request.json()
          posts.push({ method: request.method, type: request.headers.get('content-type'), body })
          const ups = body.hook_event_name === 'UserPromptSubmit'
          return Response.json(ups ? context('UserPromptSubmit', 'HTTP-HOOK-CONTEXT') : {})
        },
      })
      const http = { hooks: [{ type: 'http', url: `http://127.0.0.1:${server.port}/hook` }] }
      // "SessionStart and Setup support command and mcp_tool hooks … They don't support http".
      const p = hookPlugin(rt, 'ccs-http')
        .group('UserPromptSubmit', http)
        .group('SessionStart', http)
      try {
        await p.run(async () => {
          const session = await chat(rt, 'HTTP hook', [`Hi http. ${script({ localix: ['Hi.'] })}`])
          // "Claude Code sends the hook's JSON input as the POST request body with Content-Type:
          // application/json. The response body uses the same JSON output format".
          const [ups, ...rest] = posts
          assert.equal(rest.length, 0, JSON.stringify(posts))
          assert.equal(ups.body.hook_event_name, 'UserPromptSubmit')
          assert.equal(ups.method, 'POST')
          assert.match(ups.type, /^application\/json/)
          assert.match(ups.body.prompt, /^Hi http\./)
          assert.ok(reads(runs(rt, session, 'localix')[0]).includes('HTTP-HOOK-CONTEXT'))
        })
      } finally {
        server.stop(true)
      }
    },
  },
  {
    name: 'cc-session-hooks: a Stop prompt hook answering ok:false sends its reason back as the next instruction',
    async run(rt) {
      // The evaluator call goes to the scripted model: its own `Session ID` and script answer it.
      const verdicts = ['{"ok":false,"reason":"PROMPT-HOOK-WANTS-TESTS"}', '{"ok":true}']
      const prompt = `Session ID: CCS-PROMPT ${script({ localix: verdicts })} Should Claude stop?`
      const p = hookPlugin(rt, 'ccs-prompt').group('Stop', { hooks: [{ type: 'prompt', prompt }] })
      await p.run(async () => {
        const steps = ['First.', 'Tests run.']
        const session = await chat(rt, 'Prompt hook', [`Go. ${script({ localix: steps })}`])
        assert.equal(rt.requests({ sessionId: 'CCS-PROMPT' }).length, 2, 'both stops were judged')
        // "Stop and SubagentStop: the reason is fed back to Claude as its next instruction and
        // the turn continues".
        const [, second] = runs(rt, session, 'localix')
        assert.ok(second && reads(second).includes('PROMPT-HOOK-WANTS-TESTS'), reads(second))
        assert.equal(rt.transcript(session).at(-1).text, 'Tests run.')
      })
    },
  },
  {
    name: 'cc-session-hooks: a prompt hook’s $ARGUMENTS is replaced by the event JSON',
    async run(rt) {
      const prompt = `Session ID: CCS-ARGS ${script({ localix: ['{"ok":true}'] })} Judge $ARGUMENTS`
      const p = hookPlugin(rt, 'ccs-args').group('UserPromptSubmit', {
        hooks: [{ type: 'prompt', prompt }],
      })
      await p.run(async () => {
        await chat(rt, 'Prompt arguments', [`Hi. ${script({ localix: ['Hello.'] })}`])
        // "Use $ARGUMENTS as a placeholder for the hook input JSON."
        const text = reads(rt.requests({ sessionId: 'CCS-ARGS' })[0])
        assert.ok(text.includes('Judge {') && !text.includes('$ARGUMENTS'), text)
      })
    },
  },
  {
    name: 'cc-session-hooks: a UserPromptSubmit agent hook answering ok:false ends the turn before the model',
    async run(rt) {
      const verdict = '{"ok":false,"reason":"AGENT-HOOK-REFUSED"}'
      const prompt = `CCS-AGENT-HOOK verify. ${script({ localix: [verdict] })}`
      const p = hookPlugin(rt, 'ccs-agent').group('UserPromptSubmit', {
        hooks: [{ type: 'agent', prompt }],
      })
      await p.run(async () => {
        const prompts = [`Hi. ${script({ localix: ['NO.'] })}`]
        const session = await chat(rt, 'Agent hook', prompts, { timeoutMs: 90_000 })
        assert.ok(childRuns(rt, session, 'CCS-AGENT-HOOK').length > 0, 'the verifier ran')
        // Agent hooks: "If ok is false, Claude Code handles the block the same way as a prompt
        // hook with continueOnBlock: true"; UserPromptSubmit: "the turn ends and the reason
        // appears as a warning line".
        assert.equal(runs(rt, session, 'localix').length, 0, 'the prompt reached the model')
        assert.ok(shown(session).includes('AGENT-HOOK-REFUSED'), shown(session))
      })
    },
  },
  {
    name: 'cc-session-hooks: an asyncRewake hook that exits 2 wakes the agent with its stderr',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-rewake').on(
        'UserPromptSubmit',
        'rewake',
        `case "$input" in *REWAKE-ME*) echo 'REWAKE-STDERR' >&2; exit 2 ;; esac`,
        { asyncRewake: true },
      )
      await p.run(async () => {
        const session = await chat(rt, 'Rewake', [`REWAKE-ME ${script({ localix: ['A.', 'B.'] })}`])
        // "asyncRewake | … wakes Claude on exit code 2. The hook's stderr … is shown to Claude as
        // a system reminder".
        await until(
          () => runs(rt, session, 'localix').some((r) => reads(r).includes('REWAKE-STDERR')),
          'the rewake reached the model',
        )
        await rt.waitIdle(session.id)
      })
    },
  },
  {
    name: 'cc-session-hooks: an async hook’s additionalContext reaches the next turn',
    async run(rt) {
      const late = emit(context('UserPromptSubmit', 'ASYNC-LATE'))
      // Emits on the first prompt only, and records its pid so the scenario can wait until the
      // process has exited (a file it touches would land before its stdout is read).
      const body = `echo $$ > "$OUT/late.pid"\n[ -f "$OUT/done" ] && exit 0\ntouch "$OUT/done"\n${late}`
      const p = hookPlugin(rt, 'ccs-async').on('UserPromptSubmit', 'late', body, { async: true })
      const exited = () => {
        const file = path.join(p.out, 'late.pid')
        if (!existsSync(path.join(p.out, 'done')) || !existsSync(file)) return false
        try {
          process.kill(Number(readFileSync(file, 'utf8')), 0)
          return false
        } catch {
          return true
        }
      }
      await p.run(async () => {
        const session = await rt.createSession({ title: 'Async context' })
        await rt.say(session.id, `One. ${script({ localix: ['One.'] })}`)
        await until(exited, 'the async hook exited')
        await rt.say(session.id, `Two. ${script({ localix: ['Two.'] })}`)
        // "After the background process exits, Claude Code delivers the additionalContext … to
        // Claude on the next conversation turn."
        const [, second] = runs(rt, session, 'localix')
        assert.ok(second, 'turn 2 reached the model')
        assert.ok(reads(second).includes('ASYNC-LATE'), 'the async context never arrived')
      })
    },
  },
  {
    name: 'cc-session-hooks: once is ignored on a plugin hook',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-once').on('UserPromptSubmit', 'once', '', { once: true })
      await p.run(async () => {
        await chat(rt, 'Once', [
          `One. ${script({ localix: ['One.'] })}`,
          `Two. ${script({ localix: ['Two.'] })}`,
        ])
        // "once | If true, Claude Code removes the hook after its first successful run. … Only
        // honored for hooks declared in skill frontmatter; ignored in settings files and agent
        // frontmatter".
        assert.equal(p.seen('once').length, 2, 'the once hook ran only once')
      })
    },
  },
]
