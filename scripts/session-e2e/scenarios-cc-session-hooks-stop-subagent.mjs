/** Session E2E: Claude Code session hooks — Stop, SubagentStart/SubagentStop, SessionEnd and Notification. */
import assert from 'node:assert/strict'

import { runs, script } from './scenario-helpers.mjs'
import { until } from './scenarios-cc-helpers.mjs'
import {
  HELPER,
  SECOND_PASS_OK,
  chat,
  childRuns,
  context,
  delegate,
  emit,
  hookPlugin,
  reads,
} from './scenarios-cc-session-hooks-helpers.mjs'

export const CC_SESSION_HOOK_STOP_SUBAGENT_SCENARIOS = [
  {
    name: 'cc-session-hooks: a Stop block makes the agent continue with the reason, and the second pass has stop_hook_active',
    async run(rt) {
      const block = emit({ decision: 'block', reason: 'STOP-RUN-THE-TESTS' })
      const p = hookPlugin(rt, 'ccs-stop').on('Stop', 'stop', `${SECOND_PASS_OK}\n${block}`)
      await p.run(async () => {
        const steps = ['First pass.', 'Second pass, tests run.']
        const session = await chat(rt, 'Stop block', [`Refactor. ${script({ localix: steps })}`])
        // "decision | "block" prevents Claude from stopping"; "reason | … Tells Claude why it
        // should continue".
        const [, second, third] = runs(rt, session, 'localix')
        assert.ok(second && reads(second).includes('STOP-RUN-THE-TESTS'), reads(second))
        assert.equal(third, undefined, 'the second Stop let it end')
        assert.equal(rt.transcript(session).at(-1).text, 'Second pass, tests run.')
        // "stop_hook_active field is true when Claude Code is already continuing as a result of a
        // stop hook."
        const inputs = p.seen('stop')
        assert.equal(inputs.length, 2)
        assert.notEqual(inputs[0].stop_hook_active, true)
        assert.equal(inputs[1].stop_hook_active, true)
      })
    },
  },
  {
    name: 'cc-session-hooks: a UserPromptSubmit input carries a documented permission_mode',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-mode').on('UserPromptSubmit', 'ups')
      await p.run(async () => {
        await chat(rt, 'Input mode', [`Go. ${script({ localix: ['Done.'] })}`])
        const [ups] = p.seen('ups')
        // "permission_mode | Current permission mode: "default", "plan", "acceptEdits", "auto",
        // "dontAsk", or "bypassPermissions""; the UserPromptSubmit input example carries it.
        const modes = ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']
        assert.ok(modes.includes(ups?.permission_mode), JSON.stringify(ups))
      })
    },
  },
  {
    name: 'cc-session-hooks: a UserPromptSubmit input carries a transcript_path',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-transcript').on('UserPromptSubmit', 'ups')
      await p.run(async () => {
        await chat(rt, 'Input transcript', [`Go. ${script({ localix: ['Done.'] })}`])
        const [ups] = p.seen('ups')
        // "transcript_path | Path to conversation JSON".
        assert.ok(ups?.transcript_path, 'transcript_path is empty')
      })
    },
  },
  {
    name: 'cc-session-hooks: Stop reads last_assistant_message, with stop_hook_active false on the first pass',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-stop-input').on('Stop', 'stop')
      await p.run(async () => {
        await chat(rt, 'Stop input', [`Go. ${script({ localix: ['Final answer here.'] })}`])
        // "Stop hooks receive stop_hook_active, last_assistant_message, …"; "The
        // last_assistant_message field contains the text content of Claude's final response".
        const inputs = p.seen('stop')
        assert.equal(inputs.length, 1, JSON.stringify(inputs))
        assert.equal(inputs[0].stop_hook_active, false)
        assert.equal(inputs[0].last_assistant_message, 'Final answer here.')
      })
    },
  },
  {
    name: 'cc-session-hooks: a Stop additionalContext keeps the turn going with the context',
    async run(rt) {
      // Feeds back once, keyed on a file so the check does not lean on stop_hook_active.
      const feedback = `[ -f "$OUT/fed" ] && exit 0\ntouch "$OUT/fed"\n${emit(context('Stop', 'STOP-FEEDBACK'))}`
      const p = hookPlugin(rt, 'ccs-stop-context').on('Stop', 'stop', feedback)
      await p.run(async () => {
        const steps = ['Final answer here.', 'Acted on feedback.']
        const session = await chat(rt, 'Stop context', [`Go. ${script({ localix: steps })}`])
        // "hookSpecificOutput.additionalContext | Non-error feedback for Claude. The conversation
        // continues so Claude can act on it".
        const [, second] = runs(rt, session, 'localix')
        assert.ok(second, 'the turn ended on the Stop additionalContext')
        assert.ok(reads(second).includes('STOP-FEEDBACK'), reads(second))
        assert.equal(rt.transcript(session).at(-1).text, 'Acted on feedback.')
      })
    },
  },
  {
    name: 'cc-session-hooks: SubagentStart and SubagentStop read a plugin agent type, its id and its last message',
    async run(rt) {
      // "the agent type is the plugin-scoped identifier such as my-plugin:reviewer … anchor the
      // matcher with ^ and $".
      const p = hookPlugin(rt, 'ccs-sub')
        .file('agents/helper.md', HELPER)
        .on('SubagentStart', 'start', '', { matcher: '^ccs-sub:helper$' })
        .on('SubagentStop', 'stop', '', { matcher: '^ccs-sub:helper$' })
        .on('SubagentStart', 'other', '', { matcher: 'Explore' })
      await p.run(async () => {
        await delegate(rt, 'Help', 'ccs-sub:helper', 'CCS-CHILD-A', ['Helper done.'])
        const [stop] = await until(() => p.seen('stop').length && p.seen('stop'), 'SubagentStop')
        // SubagentStart: "receive agent_id … and agent_type with the agent name".
        const [start] = p.seen('start')
        assert.equal(start?.hook_event_name, 'SubagentStart')
        assert.equal(start.agent_type, 'ccs-sub:helper')
        assert.ok(start.agent_id, 'agent_id is set')
        assert.equal(p.seen('other').length, 0, 'a matcher naming another type does not fire')
        // SubagentStop: "stop_hook_active, agent_id, agent_type, …, and last_assistant_message".
        assert.equal(stop.agent_type, 'ccs-sub:helper')
        assert.equal(stop.agent_id, start.agent_id, 'the same subagent id on start and stop')
        assert.equal(stop.last_assistant_message, 'Helper done.')
      })
    },
  },
  {
    name: 'cc-session-hooks: SubagentStart additionalContext reaches the subagent',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-sub-context')
        .file('agents/helper.md', HELPER)
        .on('SubagentStart', 'start', emit(context('SubagentStart', 'SUB-START-CONTEXT')))
      await p.run(async () => {
        const after = await delegate(rt, 'Help', 'ccs-sub-context:helper', 'CCS-CHILD-B', [
          'Helper done.',
        ])
        assert.equal(p.seen('start').length, 1, 'SubagentStart ran once')
        const [first] = childRuns(rt, after, 'CCS-CHILD-B')
        assert.ok(first, 'the subagent asked the model')
        // "additionalContext | String added to the subagent's context at the start of its
        // conversation".
        assert.ok(reads(first).includes('SUB-START-CONTEXT'), reads(first))
      })
    },
  },
  {
    name: 'cc-session-hooks: a SubagentStop block keeps the subagent working with the reason',
    async run(rt) {
      const block = emit({ decision: 'block', reason: 'SUB-KEEP-GOING' })
      const p = hookPlugin(rt, 'ccs-sub-block')
        .file('agents/helper.md', HELPER)
        .on('SubagentStop', 'stop', `${SECOND_PASS_OK}\n${block}`)
      await p.run(async () => {
        const childSteps = ['Helper first.', 'Helper second.']
        const after = await delegate(rt, 'Help', 'ccs-sub-block:helper', 'CCS-CHILD-C', childSteps)
        // The continuation starts after SubagentStop returns: wait for its request.
        const child = await until(() => {
          const found = childRuns(rt, after, 'CCS-CHILD-C')
          return found.length >= 2 && found
        }, 'the blocked subagent asked the model again')
        // "Returning decision: "block" with a reason keeps the subagent running and delivers
        // reason to the subagent as its next instruction."
        assert.ok(reads(child[1]).includes('SUB-KEEP-GOING'), reads(child[1]))
        // "stop_hook_active field is true when Claude Code is already continuing as a result of a
        // stop hook": the second SubagentStop lets it end.
        await until(() => p.seen('stop').length >= 2, 'the second SubagentStop ran')
        assert.equal(p.seen('stop')[1].stop_hook_active, true)
      })
    },
  },
  {
    name: 'cc-session-hooks: Stop fires for the main agent only, not when a subagent finishes',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-sub-mainstop')
        .file('agents/helper.md', HELPER)
        .on('SubagentStop', 'substop')
        .on('Stop', 'mainstop')
      await p.run(async () => {
        await delegate(rt, 'Help', 'ccs-sub-mainstop:helper', 'CCS-CHILD-D', ['Helper done.'])
        await until(() => p.seen('substop').length, 'SubagentStop ran')
        // Stop "Runs when the main Claude Code agent has finished responding"; SubagentStop "Runs
        // when a Claude Code subagent has finished responding".
        assert.equal(p.seen('mainstop').length, 1, JSON.stringify(p.seen('mainstop')))
      })
    },
  },
  {
    name: 'cc-session-hooks: SessionEnd waits for the session to end, not each turn',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-end').on('SessionEnd', 'end').on('UserPromptSubmit', 'ups')
      await p.run(async () => {
        const session = await chat(rt, 'Session end', [
          `One. ${script({ localix: ['One.'] })}`,
          `Two. ${script({ localix: ['Two.'] })}`,
        ])
        assert.equal(p.seen('ups').length, 2)
        // "Runs when a Claude Code session ends", with reason clear, resume, logout,
        // prompt_input_exit or "other | Other exit reasons": deleting the session ends it.
        await rt.call(`/sessions/${session.id}`, undefined, 'DELETE')
        const [ended] = await until(() => p.seen('end').length && p.seen('end'), 'SessionEnd ran')
        assert.equal(ended.hook_event_name, 'SessionEnd')
        assert.equal(ended.reason, 'other')
        // A finished turn in an open session is none of those reasons. A SessionEnd from either
        // turn would have started before the deletion's, so it would have landed by now.
        assert.equal(p.seen('end').length, 1, JSON.stringify(p.seen('end')))
      })
    },
  },
  {
    name: 'cc-session-hooks: Notification fires with message and notification_type permission_prompt when a tool call waits for approval',
    async run(rt) {
      const p = hookPlugin(rt, 'ccs-notify').on('Notification', 'note')
      await p.run(async () => {
        const session = await rt.createSession({ title: 'Notification' })
        // `rm -rf` is a call Localix asks the person to approve; the card is dismissed unrun.
        const bash = { tool: 'bash', args: { command: 'rm -rf ./ccs-nothing-here' } }
        await rt.send(session.id, `Clean up. ${script({ localix: [bash, 'Done.'] })}`)
        try {
          const [card] = await until(async () => {
            const pending = (await rt.detail(session.id)).pendingInteractions ?? []
            return pending.length > 0 && pending
          }, 'the permission card')
          const [input] = await until(() => p.seen('note').length && p.seen('note'), 'Notification')
          // "Notification hooks receive message with the notification text, an optional title,
          // and notification_type indicating which type fired"; "permission_prompt | Claude needs
          // you to approve a tool use".
          assert.equal(input.hook_event_name, 'Notification')
          assert.ok(input.message, 'message is set')
          assert.equal(input.notification_type, 'permission_prompt')
          await rt.call('/tools/interact', { toolCallId: card.requestId, action: 'dismiss' })
        } finally {
          await rt.call(`/sessions/${session.id}/stop`, {})
          await rt.waitIdle(session.id)
        }
      })
    },
  },
]
