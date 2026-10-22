/** Session E2E: Claude Code tool hooks — PreToolUse exit codes, decisions, rewrites, context and notices. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { runs } from './scenario-helpers.mjs'
import { bash } from './scenarios-cc-helpers.mjs'
import {
  labels,
  listenNotices,
  mark,
  on,
  once,
  pre,
  readAt,
  steps,
  touch,
  turn,
  withHooks,
} from './scenarios-cc-tool-hooks-helpers.mjs'

export const CC_TOOL_HOOK_DECISION_SCENARIOS = [
  {
    name: 'cc-tool-hooks: exit 2 blocks with stderr to the model, other exits do not block',
    async run(rt) {
      const plan = {
        two: {
          exit: 2,
          stderr: 'CCTH-EXIT2 refused',
          stdout: pre({ permissionDecision: 'allow' }),
        },
        one: { exit: 1, stderr: 'ccth broke' },
      }
      const hooks = (h) => ({
        PreToolUse: [
          { matcher: 'Bash', hooks: [h('two', { if: 'Bash(true ccth-two)' })] },
          { matcher: 'Bash', hooks: [h('one', { if: 'Bash(true ccth-one)' })] },
        ],
      })
      await withHooks(rt, 'ccth-exit', { hooks, plan }, async ({ read }) => {
        const blocked = await rt.createSession({ title: 'Exit 2' })
        const call = bash(`true ccth-two && ${touch(rt, 'exit2')}`)
        const two = await turn(rt, blocked.id, `Go. ${steps(call, 'Ok.')}`)
        // "Exit 2 blocks even when your hook prints JSON … Even a permissionDecision of allow".
        assert.ok(!existsSync(mark(rt, 'exit2')), 'the exit-2 call ran')
        // "Claude receives the hook's stderr as the tool's error".
        assert.ok(readAt(rt, two.session, 1).includes('CCTH-EXIT2 refused'))

        const open = await rt.createSession({ title: 'Exit 1' })
        await turn(rt, open.id, `Go. ${steps(bash(`true ccth-one && ${touch(rt, 'exit1')}`))}`)
        assert.deepEqual(labels(read()), ['two', 'one'], 'each hook ran on its own call')
        // "Exit code 1 without valid JSON output is a non-blocking error".
        assert.ok(existsSync(mark(rt, 'exit1')), 'the exit-1 call was blocked')
      })
    },
  },
  {
    name: 'cc-tool-hooks: a hook exiting 1 with a valid JSON deny still denies',
    async run(rt) {
      const plan = { deny: { exit: 1, stdout: pre({ permissionDecision: 'deny' }) } }
      const hooks = (h) => on('PreToolUse', 'Bash', h('deny'))
      await once(rt, 'ccth-exit1j', { hooks, plan, calls: [bash(touch(rt, 'exit1-json'))] })
      // Exit-code table, valid JSON on "Any other exit code": "Success. Claude Code ignores the
      // exit code, and the fields alone decide".
      assert.ok(!existsSync(mark(rt, 'exit1-json')), 'the call ran despite the JSON deny')
    },
  },
  {
    name: 'cc-tool-hooks: deny with a reason stops the call, beats another hook’s allow, and the model reads why',
    async run(rt) {
      const reason = { permissionDecisionReason: 'CCTH-DENY no' }
      const plan = {
        deny: {
          stdout: { suppressOutput: true, ...pre({ permissionDecision: 'deny', ...reason }) },
        },
        allow: { stdout: pre({ permissionDecision: 'allow' }) },
      }
      const hooks = (h) => ({
        PreToolUse: [
          { matcher: 'Bash', hooks: [h('allow')] },
          { matcher: 'Bash', hooks: [h('deny')] },
        ],
      })
      const calls = [bash(touch(rt, 'deny'))]
      const { got, after } = await once(rt, 'ccth-deny', { hooks, plan, calls })
      // "its matching hooks run"; "precedence is deny > defer > ask > allow".
      assert.deepEqual(labels(got).sort(), ['allow', 'deny'])
      assert.ok(!existsSync(mark(rt, 'deny')), 'the denied call ran')
      // "For deny, [permissionDecisionReason is] shown to Claude".
      assert.ok(after.includes('CCTH-DENY no'), after)
    },
  },
  {
    name: 'cc-tool-hooks: PreToolUse allow skips the permission card and ask shows one',
    async run(rt) {
      const plan = {
        allow: { stdout: pre({ permissionDecision: 'allow' }) },
        ask: { stdout: pre({ permissionDecision: 'ask', permissionDecisionReason: 'CCTH-ASK' }) },
      }
      // `rm -rf` is a call Localix asks the person about; `touch` is not. The control run, with no
      // hook, proves the card is there for `allow` to skip.
      const risky = (name) => bash(`rm -rf ./ccth-nothing-here && ${touch(rt, name)}`)
      const control = await rt.createSession({ title: 'No hook' })
      const carded = await turn(rt, control.id, `Go. ${steps(risky('control'), 'Ok.')}`)
      assert.equal(carded.cards, 1, 'the call needs no approval without a hook')
      assert.ok(!existsSync(mark(rt, 'control')), 'the dismissed call ran')
      let hooks = (h) => on('PreToolUse', 'Bash', h('allow'))
      const allowed = await once(rt, 'ccth-allow', { hooks, plan, calls: [risky('allow')] })
      // "`allow` skips the permission prompt".
      assert.equal(allowed.cards, 0, 'a card was shown for an allowed call')
      assert.ok(existsSync(mark(rt, 'allow')), 'the allowed call did not run')
      hooks = (h) => on('PreToolUse', 'Bash', h('allow'), h('ask'))
      const calls = [bash(touch(rt, 'ask'))]
      const asked = await once(rt, 'ccth-ask', { hooks, plan, calls, card: 'approve' })
      // "`ask` prompts the user to confirm"; "precedence is deny > defer > ask > allow".
      assert.equal(asked.cards, 1, 'no card was shown for ask')
    },
  },
  {
    name: 'cc-tool-hooks: updatedInput rewrites a Bash command and a Write file path',
    async run(rt) {
      const allow = (updatedInput) => ({
        stdout: pre({ permissionDecision: 'allow', updatedInput }),
      })
      const plan = {
        cmd: allow({ command: 'printf CCTH-REWRITTEN' }),
        file: allow({ file_path: '@CWD@/ccth-rewritten.txt', content: 'REWRITTEN' }),
      }
      const hooks = (h) => ({
        PreToolUse: [
          { matcher: 'Bash', hooks: [h('cmd')] },
          { matcher: 'Write', hooks: [h('file')] },
        ],
      })
      const write = {
        tool: 'write',
        args: { files: [{ path: 'ccth-original.txt', content: 'O' }] },
      }
      const calls = [bash('printf CCTH-ORIGINAL'), write]
      const { got, after } = await once(rt, 'ccth-rewrite', { hooks, plan, calls })
      // "updatedInput: Modifies the tool's input parameters before execution".
      assert.ok(after.includes('CCTH-REWRITTEN') && !/CCTH-ORIGINAL$/m.test(after), after)
      const { cwd } = got[0]
      assert.equal(readFileSync(path.join(cwd, 'ccth-rewritten.txt'), 'utf8'), 'REWRITTEN')
      assert.ok(!existsSync(path.join(cwd, 'ccth-original.txt')), 'the original path was written')
    },
  },
  {
    name: 'cc-tool-hooks: PreToolUse additionalContext reaches the model beside the tool result',
    async run(rt) {
      const plan = { ctx: { stdout: pre({ additionalContext: 'CCTH-PRE-CONTEXT' }) } }
      const hooks = (h) => on('PreToolUse', 'Bash', h('ctx'))
      const { after } = await once(rt, 'ccth-prectx', { hooks, plan, calls: [bash('printf a')] })
      // "additionalContext: String added to Claude's context alongside the tool result".
      assert.ok(after.includes('CCTH-PRE-CONTEXT'), after)
    },
  },
  {
    name: 'cc-tool-hooks: continue:false stops processing, and the person sees the stopReason',
    async run(rt) {
      const plan = { stop: { stdout: { continue: false, stopReason: 'CCTH-STOP build failed' } } }
      const hooks = (h) => on('PreToolUse', 'Bash', h('stop'))
      await withHooks(rt, 'ccth-continue', { hooks, plan }, async ({ read }) => {
        const session = await rt.createSession({ title: 'Continue false' })
        // Hook notices reach the person live, as the systemMessage scenario below reads them.
        const live = listenNotices(rt, session.id)
        await live.opened
        try {
          const call = bash(touch(rt, 'continue'))
          const done = await turn(rt, session.id, `Go. ${steps(call, 'Ok.')}`)
          assert.deepEqual(labels(read()), ['stop'])
          assert.ok(!existsSync(mark(rt, 'continue')), 'the call ran')
          // "continue: If false, Claude stops processing entirely after the hook runs".
          const requests = runs(rt, done.session, 'localix')
          assert.equal(requests.length, 1, 'the model was asked again')
          // "stopReason: Message shown to the user when continue is false".
          const shown = [
            ...live.notices.map((notice) => notice.message),
            ...rt.transcript(done.session).map((message) => message.text),
            ...rt.notices(done.session).map((notice) => JSON.stringify(notice)),
          ]
          assert.ok(
            shown.some((text) => text?.includes('CCTH-STOP build failed')),
            JSON.stringify(shown),
          )
        } finally {
          live.close()
        }
      })
    },
  },
  {
    name: 'cc-tool-hooks: a PreToolUse systemMessage is shown to the person and does not block',
    async run(rt) {
      const plan = { warn: { stdout: { systemMessage: 'CCTH-WARN careful' } } }
      const hooks = (h) => on('PreToolUse', 'Bash', h('warn'))
      await withHooks(rt, 'ccth-notice', { hooks, plan }, async () => {
        const session = await rt.createSession({ title: 'System message' })
        const live = listenNotices(rt, session.id)
        await live.opened
        try {
          await turn(rt, session.id, `Go. ${steps(bash(touch(rt, 'notice')), 'Ok.')}`)
          assert.ok(existsSync(mark(rt, 'notice')), 'a systemMessage blocked the call')
          // "systemMessage: Warning message shown to the user".
          const shown = live.notices.map((notice) => notice.message)
          assert.ok(
            shown.some((m) => m.includes('CCTH-WARN careful')),
            JSON.stringify(shown),
          )
        } finally {
          live.close()
        }
      })
    },
  },
  {
    name: 'cc-tool-hooks: a timed-out hook is cancelled and does not block; `if` narrows by command',
    async run(rt) {
      const plan = { slow: { sleep: 2, stdout: pre({ permissionDecision: 'deny' }) } }
      const hooks = (h) =>
        on(
          'PreToolUse',
          'Bash',
          h('slow', { timeout: 1, if: 'Bash(touch *)' }),
          h('git', { if: 'Bash(git *)' }),
        )
      await withHooks(rt, 'ccth-timeout', { hooks, plan }, async ({ read }) => {
        const session = await rt.createSession({ title: 'Timeout' })
        await turn(rt, session.id, `Go. ${steps(bash(`echo a && ${touch(rt, 'timeout')}`))}`)
        // "On PreToolUse, a timed-out command … hook doesn't block the tool call".
        assert.ok(existsSync(mark(rt, 'timeout')), 'the timed-out deny blocked the call')
        // `if` — "each subcommand is checked": `touch` after `&&` matched, nothing is git.
        assert.deepEqual(labels(read()), ['slow'])
        await turn(rt, session.id, `Again. ${steps(bash('FOO=1 git --version'))}`)
        // "Leading VAR=value assignments are stripped before matching".
        assert.deepEqual(labels(read()), ['slow', 'git'])
      })
    },
  },
]
