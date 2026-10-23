/** Session E2E: Claude Code plugin agents — the offered name, and what a delegated child runs with. */
import assert from 'node:assert/strict'

import { script } from './scenario-helpers.mjs'
import { bash, until } from './scenarios-cc-helpers.mjs'
import {
  agentFile,
  agentPlugin,
  cappedFiles,
  cappedSteps,
  childOf,
  delegateOutput,
  delegateStep,
  delegateTurn,
  heard,
  hookLog,
  mcpServer,
  openChat,
  withPlugins,
} from './scenarios-cc-agents-helpers.mjs'

export const CC_AGENT_DELEGATION_SCENARIOS = [
  {
    name: 'cc-agents: an enabled plugin agent is offered as <plugin>:<agent> with its description, nested and nameless files included',
    async run(rt) {
      const session = await openChat(rt, 'Agent names')
      await rt.say(session.id, `Hello. ${script({ localix: ['Hello.'] })}`)
      const files = {
        'agents/reviewer.md': agentFile(
          ['name: reviewer', 'description: NAMES-DESC reviews code.'],
          'NAMES-REVIEWER body.',
        ),
        // components.md: "`name: audit` in `agents/checks/security.md` loads as
        // `my-plugin:checks:audit`".
        'agents/checks/security.md': agentFile(
          ['name: audit', 'description: Audits.'],
          'NAMES-AUDIT body.',
        ),
        // components.md: "`<name>` comes from the frontmatter `name` field, or from the file name
        // when that field is missing."
        'agents/notes.md': agentFile(['description: Takes notes.'], 'NAMES-NOTES body.'),
      }
      await withPlugins(rt, { 'e2e-ag-names': files }, async () => {
        const steps = [
          delegateStep('e2e-ag-names:reviewer', ['REVIEWER-OK']),
          delegateStep('e2e-ag-names:checks:audit', ['AUDIT-OK']),
          delegateStep('e2e-ag-names:notes', ['NOTES-OK']),
          'All three reported.',
        ]
        const { parentRuns, children } = await delegateTurn(rt, '', steps, { session })
        // sub-agents.md: "`description` | Yes | When Claude should delegate to this subagent";
        // the list changed since the first turn, so this turn carries it in full.
        const listed = heard(
          parentRuns.find((run) => run.contextHeadings.includes('# Agent types')),
        )
        for (const line of [
          '- e2e-ag-names:reviewer: NAMES-DESC reviews code.',
          '- e2e-ag-names:checks:audit: Audits.',
          '- e2e-ag-names:notes: Takes notes.',
        ])
          assert.ok(listed.includes(line), `the model was offered "${line}"`)
        for (const [marker, report] of [
          ['NAMES-REVIEWER body.', 'REVIEWER-OK'],
          ['NAMES-AUDIT body.', 'AUDIT-OK'],
          ['NAMES-NOTES body.', 'NOTES-OK'],
        ]) {
          assert.equal(childOf(children, marker).at(-1).answered.text, report)
          assert.ok(heard(parentRuns.at(-1)).includes(report), `the parent read ${report}`)
        }
      })
    },
  },
  {
    name: 'cc-agents: a delegated plugin agent runs with its body as prompt, tools minus disallowedTools, and its model',
    async run(rt) {
      const files = {
        // sub-agents.md: "If both are set, `disallowedTools` is applied first, then `tools` is
        // resolved against the remaining pool. A tool listed in both is removed."
        ...agentPlugin(
          'scoped',
          ['tools: Read, Grep, Edit, Bash', 'disallowedTools: Bash, Write', 'model: gpt-4o-mini'],
          'TOOLS-SCOPED body.',
        ),
        // sub-agents.md: "uses `disallowedTools` to inherit the subagent's tool pool except Write
        // and Edit. The subagent keeps Bash"; "inherit: use the same model as the main
        // conversation".
        ...agentPlugin(
          'denylist',
          ['disallowedTools: Write, Edit', 'model: inherit'],
          'TOOLS-DENYLIST body.',
        ),
      }
      await withPlugins(rt, { 'e2e-ag-tools': files }, async () => {
        const { children } = await delegateTurn(rt, 'Agent tools', [
          delegateStep('e2e-ag-tools:scoped', ['SCOPED-OK']),
          delegateStep('e2e-ag-tools:denylist', ['DENYLIST-OK']),
          'Both reported.',
        ])
        const [scoped] = childOf(children, 'TOOLS-SCOPED body.')
        // components.md: "the body is its system prompt" (childOf matches on the prompt's start).
        for (const tool of ['read', 'search', 'edit'])
          assert.ok(scoped.tools.includes(tool), `scoped keeps ${tool}: ${scoped.tools}`)
        for (const tool of ['bash', 'write'])
          assert.ok(!scoped.tools.includes(tool), `scoped holds ${tool}: ${scoped.tools}`)
        // sub-agents.md: "2. The subagent definition's `model` frontmatter".
        assert.equal(scoped.model, 'gpt-4o-mini')

        const [denylist] = childOf(children, 'TOOLS-DENYLIST body.')
        for (const tool of ['read', 'bash'])
          assert.ok(denylist.tools.includes(tool), `denylist keeps ${tool}: ${denylist.tools}`)
        for (const tool of ['write', 'edit'])
          assert.ok(!denylist.tools.includes(tool), `denylist holds ${tool}`)
        assert.equal(denylist.model, 'gpt-4o', '`inherit` runs on the main conversation’s model')
      })
    },
  },
  {
    name: 'cc-agents: a tools list without Skill leaves the subagent without the Skill tool',
    async run(rt) {
      const files = agentPlugin('reader', ['tools: Read'], 'SKILL-READER body.')
      await withPlugins(rt, { 'e2e-ag-skill': files }, async () => {
        const { children } = await delegateTurn(rt, 'Agent skill tool', [
          delegateStep('e2e-ag-skill:reader', ['READER-OK']),
          'Reported.',
        ])
        const [reader] = childOf(children, 'SKILL-READER body.')
        assert.ok(reader.tools.includes('read'))
        // sub-agents.md: "To prevent a subagent from invoking skills entirely, omit `Skill` from
        // the `tools` list"; "`tools` ... Tools the subagent can use".
        assert.ok(!reader.tools.includes('skill'), `the child holds skill: ${reader.tools}`)
      })
    },
  },
  {
    name: 'cc-agents: a subagent without a tools list inherits the main conversation’s plugin MCP tools',
    async run(rt) {
      const files = {
        ...agentPlugin('inheritor', [], 'MCPIN-INHERITOR body.'),
        '.mcp.json': JSON.stringify({ mcpServers: { ctl: mcpServer(rt, 'ag-mcpin') } }),
      }
      await withPlugins(rt, { 'e2e-ag-mcpin': files }, async () => {
        // Localix defers MCP schemas behind `activate_tools`, as Claude Code does behind tool
        // search; the child loads the tool under either spelling.
        const names = ['mcp__plugin_e2e-ag-mcpin_ctl__echo', 'mcp_e2e_ag_mcpin_ctl_echo']
        const { children } = await delegateTurn(rt, 'Agent MCP inheritance', [
          delegateStep('e2e-ag-mcpin:inheritor', [
            { tool: 'activate_tools', args: { names } },
            'INHERITOR-OK',
          ]),
          'Reported.',
        ])
        await until(() => hookLog(rt, 'ag-mcpin').length > 0, 'the plugin MCP server started')
        // sub-agents.md: "Subagents inherit the built-in tools and MCP tools available in the
        // main conversation".
        const last = childOf(children, 'MCPIN-INHERITOR body.').at(-1)
        assert.ok(
          names.some((name) => last.tools.includes(name)),
          `the child never held the plugin's MCP tool: ${last.tools}`,
        )
      })
    },
  },
  {
    name: 'cc-agents: maxTurns stops the subagent after that many turns',
    async run(rt) {
      await withPlugins(rt, { 'e2e-ag-turns': cappedFiles() }, async () => {
        const { children } = await delegateTurn(rt, 'Agent maxTurns', [
          delegateStep('e2e-ag-turns:capped', cappedSteps()),
          'Got what it had.',
        ])
        const capped = childOf(children, 'CAPPED body.')
        // sub-agents.md: "`maxTurns` | Maximum number of agentic turns before the subagent stops".
        assert.equal(capped.length, 2, `the child made ${capped.length} model requests`)
        assert.ok(!capped.some((run) => run.answered.text === 'FULL'))
      })
    },
  },
  {
    name: 'cc-agents: a subagent stopped at maxTurns returns its output marked partial, not a failure',
    async run(rt) {
      // Two children, so the result is checked whichever way it reaches the call: one that may end
      // inside the delegation's settle window (the call's own line), and one held past it by a
      // 2.5 s first reply (the held report).
      await withPlugins(rt, { 'e2e-ag-partial': cappedFiles() }, async () => {
        const slowFirst = { ...bash('echo T1'), wait: 2500 }
        const { parentRuns } = await delegateTurn(rt, 'Agent maxTurns partial', [
          delegateStep('e2e-ag-partial:capped', cappedSteps(), { title: 'Capped fast' }),
          delegateStep('e2e-ag-partial:capped', cappedSteps(slowFirst), { title: 'Capped slow' }),
          'Got what they had.',
        ])
        // sub-agents.md: "When the subagent reaches the limit, Claude Code returns its output
        // marked as partial, and Claude can resume it to continue."
        for (const title of ['Capped fast', 'Capped slow']) {
          const result = delegateOutput(parentRuns.at(-1), title)
          assert.ok(!/fail|error/i.test(result), `"${title}" read as a failure: ${result}`)
          assert.match(result, /partial/i, `"${title}" was not marked partial: ${result}`)
        }
      })
    },
  },
]
