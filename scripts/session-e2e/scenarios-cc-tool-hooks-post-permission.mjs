/** Session E2E: Claude Code tool hooks — PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, PostToolBatch, disabled plugins. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import { runs } from './scenario-helpers.mjs'
import { bash } from './scenarios-cc-helpers.mjs'
import {
  labels,
  mark,
  on,
  once,
  pre,
  readAt,
  readFrom,
  steps,
  touch,
  turn,
  withHooks,
} from './scenarios-cc-tool-hooks-helpers.mjs'

export const CC_TOOL_HOOK_POST_PERMISSION_SCENARIOS = [
  {
    name: 'cc-tool-hooks: PostToolUse additionalContext and a block reason reach the model with the output',
    async run(rt) {
      const post = { hookEventName: 'PostToolUse', additionalContext: 'CCTH-POST-CONTEXT' }
      const plan = {
        ctx: { stdout: { hookSpecificOutput: post } },
        block: { stdout: { decision: 'block', reason: 'CCTH-POST-BLOCK' } },
      }
      const hooks = (h) => on('PostToolUse', 'Bash', h('ctx'), h('block'))
      const calls = [bash('printf ccth-out')]
      const { got, after } = await once(rt, 'ccth-post', { hooks, plan, calls })
      // "decision: block adds the reason next to the tool result. Claude still sees the
      // original output"; additionalContext is "added to Claude's context alongside".
      for (const text of ['ccth-out', 'CCTH-POST-CONTEXT', 'CCTH-POST-BLOCK'])
        assert.ok(after.includes(text), `${text} missing: ${after}`)
      const [r] = got
      assert.deepEqual(
        [r.hook_event_name, r.tool_name, r.tool_input.command],
        ['PostToolUse', 'Bash', 'printf ccth-out'],
      )
    },
  },
  {
    name: 'cc-tool-hooks: PostToolUse reads tool_use_id and Bash’s output shape, and updatedToolOutput in that shape replaces it',
    async run(rt) {
      const shape = { stdout: 'CCTH-REDACTED', stderr: '', interrupted: false, isImage: false }
      const output = { hookEventName: 'PostToolUse', updatedToolOutput: shape }
      const plan = { post: { stdout: { hookSpecificOutput: output } } }
      const hooks = (h) => ({
        ...on('PreToolUse', 'Bash', h('pre')),
        ...on('PostToolUse', 'Bash', h('post')),
      })
      // The output is not the command's text, so the prompt never holds it.
      const calls = [bash('printf ccth-%s secret')]
      const { got, after } = await once(rt, 'ccth-postout', { hooks, plan, calls })
      const [p, q] = got
      // The PostToolUse example carries "tool_use_id"; "Bash returns an object with stdout,
      // stderr, interrupted, and isImage fields".
      assert.equal(q.tool_use_id, p.tool_use_id, 'tool_use_id')
      assert.equal(q.tool_response?.stdout, 'ccth-secret', JSON.stringify(q.tool_response))
      // "updatedToolOutput: Replaces the tool's output with the provided value before it is sent".
      const replaced = after.includes('CCTH-REDACTED') && !after.includes('ccth-secret')
      assert.ok(replaced, JSON.stringify(after))
    },
  },
  {
    name: 'cc-tool-hooks: a failing Bash command fires PostToolUseFailure, not PostToolUse',
    async run(rt) {
      const context = {
        hookEventName: 'PostToolUseFailure',
        additionalContext: 'CCTH-FAIL-CONTEXT',
      }
      const plan = { fail: { stdout: { hookSpecificOutput: context } } }
      const hooks = (h) => ({
        ...on('PostToolUse', 'Bash', h('post')),
        ...on('PostToolUseFailure', 'Bash', h('fail')),
      })
      const calls = [bash('ls /ccth-missing-dir')]
      const { got, after } = await once(rt, 'ccth-fail', { hooks, plan, calls })
      // "Runs when a tool that started executing fails"; for Bash "a command that ran and
      // exited produces a first line `Exit code N`".
      assert.deepEqual(labels(got), ['fail'])
      assert.equal(got[0].tool_input.command, 'ls /ccth-missing-dir')
      assert.match(got[0].error, /^Exit code \d+/)
      assert.ok(after.includes('CCTH-FAIL-CONTEXT'), after)
    },
  },
  {
    name: 'cc-tool-hooks: PermissionRequest allow, deny and updatedInput answer the card for the person',
    async run(rt) {
      const decide = (decision) => ({
        stdout: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } },
      })
      const call = (label, marker = label) =>
        `true ccth-pr-${label} && rm -rf ./ccth-none && ${touch(rt, `pr-${marker}`)}`
      const plan = {
        allow: decide({ behavior: 'allow' }),
        deny: decide({ behavior: 'deny', message: 'CCTH-PR-DENIED' }),
        rewrite: decide({ behavior: 'allow', updatedInput: { command: call('new', 'rewritten') } }),
        two: { exit: 2, stderr: 'ignored' },
      }
      const hooks = (h) => ({
        PermissionRequest: Object.keys(plan).map((label) => ({
          matcher: 'Bash',
          hooks: [h(label, { if: `Bash(true ccth-pr-${label})` })],
        })),
      })
      await withHooks(rt, 'ccth-permreq', { hooks, plan }, async ({ read }) => {
        const session = await rt.createSession({ title: 'PermissionRequest' })
        // A deciding hook must withdraw the card itself: the harness leaves it unanswered.
        const ask = (label, options = { card: 'leave' }) =>
          turn(rt, session.id, `${label}. ${steps(bash(call(label)), 'Ok.')}`, options)
        await ask('allow')
        // "behavior: allow grants the permission" — the call runs without the person.
        assert.ok(existsSync(mark(rt, 'pr-allow')), 'the hook-allowed call did not run')
        const [r] = read()
        // "PermissionRequest hooks receive tool_name and tool_input … but without tool_use_id".
        assert.deepEqual([r.hook_event_name, r.tool_name], ['PermissionRequest', 'Bash'])
        assert.equal(r.tool_input.command, call('allow'))
        assert.equal(r.tool_use_id, undefined)

        const before = runs(rt, await rt.detail(session.id), 'localix').length
        const denied = await ask('deny')
        assert.ok(!existsSync(mark(rt, 'pr-deny')), 'the hook-denied call ran')
        // "message: For deny only: tells Claude why the permission was denied".
        assert.ok(readFrom(rt, denied.session, before).includes('CCTH-PR-DENIED'))

        await ask('rewrite')
        // "updatedInput: For allow only: modifies the tool's input parameters before execution".
        assert.ok(existsSync(mark(rt, 'pr-rewritten')), 'the rewrite did not run')
        assert.ok(!existsSync(mark(rt, 'pr-rewrite')), 'the original call ran')

        // "A hook that exits 2 without a decision object leaves the permission flow unchanged".
        // The person approves only after the hook has run and had a second to answer: had exit 2
        // denied, the card would be gone and the call refused.
        const ran = () => read().some((r) => r._label === 'two')
        const two = await ask('two', { card: 'approve', ready: ran, graceMs: 1_000 })
        assert.ok(ran(), 'the PermissionRequest hook did not run')
        assert.equal(two.cards, 1, 'the card was not left to the person')
        assert.ok(existsSync(mark(rt, 'pr-two')), 'the person’s approval did not apply')
      })
    },
  },
  {
    name: 'cc-tool-hooks: PermissionDenied fires when the mode refuses a call on its own, and retry tells the model',
    async run(rt) {
      const plan = {
        retry: {
          stdout: { hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } },
        },
        block: {
          stdout: pre({ permissionDecision: 'deny', permissionDecisionReason: 'CCTH-PRE' }),
        },
      }
      const hooks = (h) => ({
        ...on('PreToolUse', 'Bash', h('block', { if: 'Bash(true ccth-pd-pre)' })),
        ...on('PermissionDenied', 'Bash', h('retry')),
      })
      await withHooks(rt, 'ccth-denied', { hooks, plan }, async ({ read }) => {
        const session = await rt.createSession({ title: 'PermissionDenied' })
        // Localix's unattended mode stands in for auto mode: nobody approves, and the mode itself
        // refuses a call that cannot be undone (`halt`, matched as a word) — it would only echo.
        await rt.api(`/sessions/${session.id}`, { permissionMode: 'autonomous' }, 'PATCH')
        const denied = await turn(rt, session.id, `Go. ${steps(bash('echo halt'), 'Ok.')}`)
        const [r] = read()
        // PermissionDenied input: "tool_name, tool_input, tool_use_id, and reason".
        assert.deepEqual(
          [r?.hook_event_name, r.tool_name, r.tool_input.command],
          ['PermissionDenied', 'Bash', 'echo halt'],
        )
        assert.ok(r.tool_use_id && r.reason, 'tool_use_id and reason')
        // "When retry is true, Claude Code adds a message … telling the model it may retry".
        assert.match(readAt(rt, denied.session, 1), /may retry/i)

        // "it doesn't run … when a PreToolUse hook blocks a call".
        await turn(rt, session.id, `Again. ${steps(bash('true ccth-pd-pre && echo halt'))}`)
        assert.deepEqual(labels(read()), ['retry', 'block'])
      })
    },
  },
  {
    name: 'cc-tool-hooks: PostToolBatch reads the batch and a block stops the loop before the next request',
    async run(rt) {
      const plan = { stop: { stdout: { decision: 'block', reason: 'CCTH-BATCH-STOP' } } }
      const hooks = (h) => ({ PostToolBatch: [{ hooks: [h('stop')] }] })
      const calls = [bash('printf ccth-batch')]
      const { got, requests } = await once(rt, 'ccth-batch', { hooks, plan, calls })
      const [r] = got
      // PostToolBatch input: `tool_calls`, each with tool_name, tool_input, tool_use_id and the
      // tool_response the model receives.
      assert.equal(r.hook_event_name, 'PostToolBatch')
      assert.equal(r.tool_calls.length, 1)
      const [c] = r.tool_calls
      assert.deepEqual([c.tool_name, c.tool_input.command], ['Bash', 'printf ccth-batch'])
      assert.ok(c.tool_use_id && JSON.stringify(c.tool_response).includes('ccth-batch'))
      // "Returning decision: block … stops the agentic loop before the next model call".
      assert.equal(requests.length, 1, 'the model was asked again')
    },
  },
  {
    name: 'cc-tool-hooks: a disabled plugin’s hooks do not fire',
    async run(rt) {
      const hooks = (h) => on('PreToolUse', '*', h('pre'))
      await withHooks(rt, 'ccth-disabled', { hooks }, async ({ read }) => {
        const session = await rt.createSession({ title: 'Disabled' })
        await turn(rt, session.id, `Go. ${steps(bash('printf on'))}`)
        assert.equal(read().length, 1, 'the enabled plugin’s hook did not fire')
        const off = await rt.say(session.id, '/plugin disable ccth-disabled')
        assert.match(rt.transcript(off).at(-1).text, /Disabled/)
        await turn(rt, session.id, `Again. ${steps(bash('printf off'))}`)
        // Plugin hooks run "When plugin is enabled" (hooks.md, Hook locations).
        assert.equal(read().length, 1, 'a disabled plugin’s hook fired')
      })
    },
  },
]
