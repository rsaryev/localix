/** Session E2E: Claude Code plugin agents — background, the plugin agent setting, same-named agents and Stop. */
import assert from 'node:assert/strict'

import { script } from './scenario-helpers.mjs'
import { until } from './scenarios-cc-helpers.mjs'
import {
  agentPlugin,
  childOf,
  delegateOutput,
  delegateStep,
  delegateTurn,
  heard,
  hookCommand,
  hookLog,
  openChat,
  requestsOf,
  withPlugins,
} from './scenarios-cc-agents-helpers.mjs'

export const CC_AGENT_SETTING_SCENARIOS = [
  {
    name: 'cc-agents: background: true returns the delegating call at once, and the report arrives later',
    async run(rt) {
      const files = agentPlugin('bg', ['tools: Read', 'background: true'], 'BG body.')
      await withPlugins(rt, { 'e2e-ag-bg': files }, async () => {
        const { after, parentRuns } = await delegateTurn(rt, 'Background agent', [
          delegateStep('e2e-ag-bg:bg', [{ wait: 3000, text: 'BG-REPORT' }], { title: 'BG task' }),
          'PARENT-WENT-ON',
        ])
        // sub-agents.md: "`background` | Set to `true` to keep this subagent in the background
        // even when Claude asks to wait for it". The call's own result, whenever the parent's
        // next request is made, holds no report: a held call would carry it.
        const [, second] = parentRuns
        assert.ok(second, 'the parent went on after the delegate call')
        const result = delegateOutput(second, 'BG task')
        assert.ok(!result.includes('BG-REPORT'), `the call waited for the report: ${result}`)
        assert.match(result, /background/i, `the call did not say it runs in the background`)
        await until(
          () => requestsOf(rt, after).parentRuns.some((run) => heard(run).includes('BG-REPORT')),
          'the background report reached the parent',
          30_000,
        )
      })
    },
  },
  {
    name: 'cc-agents: the manifest settings agent runs the main chat with its prompt and without its disallowedTools',
    async run(rt) {
      // components.md: "add a `settings.json` at the plugin root, or put the same object inline in
      // the `settings` manifest key"; settings-reference.md: "`agent` ... applies that
      // subagent's system prompt, tool restrictions, and model to your session".
      const manifest = { name: 'e2e-ag-main', version: '1.0.0', settings: { agent: 'lead' } }
      const files = {
        '.claude-plugin/plugin.json': JSON.stringify(manifest),
        ...agentPlugin('lead', ['disallowedTools: Bash, Write'], 'MAIN-LEAD body.'),
      }
      await withPlugins(rt, { 'e2e-ag-main': files }, async () => {
        const session = await openChat(rt, 'Main agent')
        const after = await rt.say(session.id, `Hi. ${script({ localix: ['Hi.'] })}`)
        const [run] = requestsOf(rt, after).parentRuns
        assert.ok(run.system.startsWith('MAIN-LEAD body.'), 'the agent’s prompt runs the chat')
        assert.ok(run.tools.includes('read'), 'its other tools stay')
        for (const tool of ['bash', 'write'])
          assert.ok(!run.tools.includes(tool), `the main chat holds ${tool}`)
      })
    },
  },
  {
    name: 'cc-agents: two plugins’ same-named agents stay apart by scoped name, and a disabled plugin’s agent is gone',
    async run(rt) {
      const helper = (body) => agentPlugin('helper', ['tools: Read'], body)
      const plugins = {
        'e2e-ag-alpha': helper('ALPHA-HELPER body.'),
        'e2e-ag-beta': helper('BETA-HELPER body.'),
      }
      await withPlugins(rt, plugins, async () => {
        const session = await openChat(rt, 'Agent collisions')
        const { children } = await delegateTurn(
          rt,
          '',
          [
            delegateStep('e2e-ag-beta:helper', ['BETA-OK']),
            delegateStep('e2e-ag-alpha:helper', ['ALPHA-OK']),
            'Both reported.',
          ],
          { session },
        )
        // components.md: "This agent is named `my-plugin:security-reviewer` ... The name form is
        // `<plugin>:<name>`".
        assert.equal(childOf(children, 'BETA-HELPER body.').at(-1).answered.text, 'BETA-OK')
        assert.equal(childOf(children, 'ALPHA-HELPER body.').at(-1).answered.text, 'ALPHA-OK')

        const disabled = await rt.say(session.id, '/plugin disable e2e-ag-beta')
        assert.match(rt.transcript(disabled).at(-1).text, /Disabled `e2e-ag-beta`/)
        const { parentRuns } = await delegateTurn(
          rt,
          '',
          [delegateStep('e2e-ag-beta:helper', ['BETA-AGAIN']), 'Refused.'],
          { session },
        )
        // sub-agents.md: "Plugin's `agents/` directory | Where plugin is enabled".
        const turn = parentRuns.find((run) => JSON.stringify(run.messages).includes('BETA-AGAIN'))
        const listed = heard(turn).split('<runtime-context update>').at(-1)
        assert.ok(listed.includes('- e2e-ag-alpha:helper'), `the latest list: ${listed}`)
        assert.ok(!listed.includes('- e2e-ag-beta:helper'), `the latest list: ${listed}`)
        assert.ok(!rt.requests().some((run) => run.answered?.text === 'BETA-AGAIN'), 'beta ran')
        assert.match(heard(parentRuns.at(-1)), /No enabled agent \\?"e2e-ag-beta:helper/)
      })
    },
  },
  {
    name: 'cc-agents: a plugin Stop hook runs when the main agent finishes, not when a subagent does',
    async run(rt) {
      const files = agentPlugin('closer', ['tools: Read'], 'STOPSCOPE-CLOSER body.', {
        Stop: [[null, hookCommand(rt, 'ag-scope-stop')]],
        SubagentStop: [[null, hookCommand(rt, 'ag-scope-substop')]],
      })
      await withPlugins(rt, { 'e2e-ag-stopscope': files }, async () => {
        await delegateTurn(rt, 'Stop hook scope', [
          delegateStep('e2e-ag-stopscope:closer', ['CLOSER-REPORT']),
          'PARENT-DONE',
        ])
        // hooks.md: Stop "Runs when the main Claude Code agent has finished responding";
        // SubagentStop "When a subagent finishes".
        const substop = await until(
          () => hookLog(rt, 'ag-scope-substop')[0]?.input,
          'SubagentStop ran for the child',
        )
        assert.equal(substop.last_assistant_message, 'CLOSER-REPORT')
        await until(() => hookLog(rt, 'ag-scope-stop').length > 0, 'Stop ran for the main agent')
        const stops = hookLog(rt, 'ag-scope-stop').map((entry) => entry.input)
        assert.deepEqual(
          stops.map((input) => input.last_assistant_message),
          ['PARENT-DONE'],
          `Stop ran for: ${JSON.stringify(stops)}`,
        )
      })
    },
  },
]
