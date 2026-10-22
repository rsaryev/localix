/** Session E2E: Claude Code plugin agents — ignored agent fields, and SubagentStart / SubagentStop and tool hooks. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import { bash, until } from './scenarios-cc-helpers.mjs'
import {
  agentFile,
  agentPlugin,
  childOf,
  delegateStep,
  delegateTurn,
  heard,
  hookCommand,
  hookLog,
  hooksJson,
  mcpServer,
  withPlugins,
} from './scenarios-cc-agents-helpers.mjs'

export const CC_AGENT_HOOK_SCENARIOS = [
  {
    name: 'cc-agents: a plugin agent’s hooks, mcpServers and permissionMode are ignored; the plugin’s own hooks apply inside it',
    async run(rt) {
      const deny = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'FRONTMATTER-HOOK-DENIED',
        },
      }
      // The frontmatter server and the control in `.mcp.json` run the same real server, which
      // lists a tool; each logs its start under its own tag.
      const inline = mcpServer(rt, 'ag-mcp-inline')
      const control = mcpServer(rt, 'ag-mcp-control')
      // The frontmatter hooks and the control hooks in hooks.json run the same way: a script
      // under `${CLAUDE_PLUGIN_ROOT}`, so a variable that failed to expand fails both alike.
      const viaRoot = (script) => `sh "\${CLAUDE_PLUGIN_ROOT}/${script}"`
      const files = {
        'fm-pre.sh': hookCommand(rt, 'ag-fm-pre', deny),
        'fm-stop.sh': hookCommand(rt, 'ag-fm-stop'),
        'ctl-pre.sh': hookCommand(rt, 'ag-ctl-pre'),
        'ctl-substop.sh': hookCommand(rt, 'ag-ctl-substop'),
        '.mcp.json': JSON.stringify({ mcpServers: { ctl: control } }),
        'agents/guarded.md': agentFile(
          [
            'name: guarded',
            'description: Runs a command.',
            'permissionMode: plan',
            'mcpServers:',
            '  - e2e-inline:',
            `      command: ${inline.command}`,
            `      args: ${JSON.stringify(inline.args)}`,
            '      env:',
            `        E2E_LOG: ${JSON.stringify(inline.env.E2E_LOG)}`,
            'hooks:',
            '  PreToolUse:',
            '    - matcher: "Bash"',
            '      hooks:',
            '        - type: command',
            `          command: 'sh "\${CLAUDE_PLUGIN_ROOT}/fm-pre.sh"'`,
            '  Stop:',
            '    - hooks:',
            '        - type: command',
            `          command: 'sh "\${CLAUDE_PLUGIN_ROOT}/fm-stop.sh"'`,
          ],
          'GUARDED body.',
        ),
        'hooks/hooks.json': hooksJson({
          PreToolUse: [['Bash', viaRoot('ctl-pre.sh')]],
          SubagentStop: [[null, viaRoot('ctl-substop.sh')]],
        }),
      }
      await withPlugins(rt, { 'e2e-ag-ignored': files }, async () => {
        const { children } = await delegateTurn(rt, 'Agent ignored fields', [
          delegateStep('e2e-ag-ignored:guarded', [bash('echo GUARDED-RAN'), 'GUARDED-OK']),
          'Reported.',
        ])
        const guarded = childOf(children, 'GUARDED body.')
        assert.ok(heard(guarded.at(-1)).includes('GUARDED-RAN'), 'bash ran in the child')
        // sub-agents.md: "Hooks from settings files, managed policy settings, and plugins all
        // apply inside subagents". These are the controls: the same `${CLAUDE_PLUGIN_ROOT}` form
        // runs, and the same server, declared by the plugin, starts (for the parent's chat).
        const pre = hookLog(rt, 'ag-ctl-pre').map((entry) => entry.input)
        assert.ok(
          pre.some(
            (input) =>
              input.tool_name === 'Bash' && input.tool_input.command === 'echo GUARDED-RAN',
          ),
          `the plugin PreToolUse hook saw the child's Bash call: ${JSON.stringify(pre)}`,
        )
        await until(() => hookLog(rt, 'ag-ctl-substop').length > 0, 'the control SubagentStop ran')
        await until(() => hookLog(rt, 'ag-mcp-control').length > 0, 'the control server started')
        // components.md: "**Ignored fields**: `permissionMode`, `hooks`, `mcpServers`, and
        // `initialPrompt`. An agent file can't add hooks or MCP servers on its own".
        assert.equal(hookLog(rt, 'ag-fm-pre').length, 0, 'the frontmatter PreToolUse hook ran')
        // hooks.md: "Claude Code converts a `Stop` hook here to `SubagentStop`", so honoured it
        // would have run beside the control SubagentStop.
        assert.equal(hookLog(rt, 'ag-fm-stop').length, 0, 'the frontmatter Stop hook ran')
        assert.equal(hookLog(rt, 'ag-mcp-inline').length, 0, 'the frontmatter MCP server started')
        for (const run of guarded)
          assert.ok(
            !run.tools.some((tool) => /e2e.inline/.test(tool)),
            `its MCP tool: ${run.tools}`,
          )
        assert.ok(!guarded[0].system.includes('# Plan mode'), 'permissionMode: plan applied')
      })
    },
  },
  {
    name: 'cc-agents: SubagentStart and SubagentStop get the scoped agent_type and one agent_id, and an anchored matcher selects it',
    async run(rt) {
      const files = agentPlugin('worker', ['tools: Read'], 'LIFE-WORKER body.', {
        // hooks.md: "For subagents shipped by a plugin, the agent type is the plugin-scoped
        // identifier such as `my-plugin:reviewer` ... anchor the matcher with `^` and `$`".
        SubagentStart: [
          ['^e2e-ag-life:worker$', hookCommand(rt, 'ag-life-start')],
          ['^e2e-ag-life:work$', hookCommand(rt, 'ag-life-nomatch')],
        ],
        SubagentStop: [[null, hookCommand(rt, 'ag-life-stop')]],
      })
      await withPlugins(rt, { 'e2e-ag-life': files }, async () => {
        await delegateTurn(rt, 'Agent lifecycle hooks', [
          delegateStep('e2e-ag-life:worker', ['WORKER-REPORT']),
          'Reported.',
        ])
        const stop = await until(() => hookLog(rt, 'ag-life-stop')[0]?.input, 'SubagentStop ran')
        const start = await until(() => hookLog(rt, 'ag-life-start')[0]?.input, 'SubagentStart ran')
        // hooks.md: "SubagentStart hooks receive `agent_id` with the unique identifier for the
        // subagent and `agent_type` with the agent name that the matcher filters on."
        assert.equal(start.hook_event_name, 'SubagentStart')
        assert.equal(start.agent_type, 'e2e-ag-life:worker')
        assert.ok(start.agent_id, 'SubagentStart has no agent_id')
        assert.equal(hookLog(rt, 'ag-life-nomatch').length, 0, 'an anchored non-match ran')
        // hooks.md: "SubagentStop hooks receive ... `agent_id`, `agent_type` ... and
        // `last_assistant_message` ... the text content of the subagent's final response".
        assert.equal(stop.hook_event_name, 'SubagentStop')
        assert.equal(stop.agent_type, 'e2e-ag-life:worker')
        assert.equal(stop.agent_id, start.agent_id, 'one agent_id from start to stop')
        assert.equal(stop.last_assistant_message, 'WORKER-REPORT')
      })
    },
  },
  {
    name: 'cc-agents: SubagentStop input carries stop_hook_active false on a stop no hook forced',
    async run(rt) {
      const files = agentPlugin('scribe', ['tools: Read'], 'STOPIN-SCRIBE body.', {
        SubagentStop: [[null, hookCommand(rt, 'ag-stopin')]],
      })
      await withPlugins(rt, { 'e2e-ag-stopin': files }, async () => {
        await delegateTurn(rt, 'SubagentStop input', [
          delegateStep('e2e-ag-stopin:scribe', ['SCRIBE-REPORT']),
          'Reported.',
        ])
        const stop = await until(() => hookLog(rt, 'ag-stopin')[0]?.input, 'SubagentStop ran')
        // hooks.md: "SubagentStop hooks receive `stop_hook_active`, `agent_id`, `agent_type`,
        // `agent_transcript_path`, and `last_assistant_message`" (example: "stop_hook_active": false).
        assert.equal(stop.stop_hook_active, false, `stop_hook_active: ${JSON.stringify(stop)}`)
      })
    },
  },
  {
    name: 'cc-agents: SubagentStop input carries agent_transcript_path, the subagent’s own transcript',
    known:
      'Localix keeps no transcript files: `agent_transcript_path` is sent empty, as `transcript_path` is',
    async run(rt) {
      const files = agentPlugin('scribe', ['tools: Read'], 'TRANSCRIPT-SCRIBE body.', {
        SubagentStop: [[null, hookCommand(rt, 'ag-stoppath')]],
      })
      await withPlugins(rt, { 'e2e-ag-stoppath': files }, async () => {
        await delegateTurn(rt, 'SubagentStop transcript', [
          delegateStep('e2e-ag-stoppath:scribe', ['SCRIBE-REPORT']),
          'Reported.',
        ])
        const stop = await until(() => hookLog(rt, 'ag-stoppath')[0]?.input, 'SubagentStop ran')
        // hooks.md: "`agent_transcript_path` is the subagent's own transcript stored in a nested
        // `subagents/` folder".
        const file = stop.agent_transcript_path
        assert.ok(file && existsSync(file), `agent_transcript_path: ${JSON.stringify(stop)}`)
      })
    },
  },
  {
    name: 'cc-agents: SubagentStart additionalContext reaches the subagent before its first prompt',
    async run(rt) {
      const note = {
        hookSpecificOutput: {
          hookEventName: 'SubagentStart',
          additionalContext: 'START-CONTEXT-NOTE',
        },
      }
      const files = agentPlugin('briefed', ['tools: Read'], 'CTX-BRIEFED body.', {
        SubagentStart: [[null, hookCommand(rt, 'ag-ctx-start', note)]],
      })
      await withPlugins(rt, { 'e2e-ag-ctx': files }, async () => {
        const { children } = await delegateTurn(rt, 'SubagentStart context', [
          delegateStep('e2e-ag-ctx:briefed', ['BRIEFED-OK']),
          'Reported.',
        ])
        await until(() => hookLog(rt, 'ag-ctx-start').length > 0, 'SubagentStart ran')
        assert.equal(hookLog(rt, 'ag-ctx-start').length, 1, 'SubagentStart ran once')
        const [first] = childOf(children, 'CTX-BRIEFED body.')
        // hooks.md: "`additionalContext` | String added to the subagent's context at the start of
        // its conversation, before its first prompt".
        const seen = [heard(first), ...first.reminders].join('\n')
        assert.ok(seen.includes('START-CONTEXT-NOTE'), 'the child never read the note')
      })
    },
  },
  {
    name: 'cc-agents: a SubagentStop block keeps the subagent running with the reason as its next instruction',
    async run(rt) {
      const block = { decision: 'block', reason: 'STOP-BLOCK-REASON: add the summary.' }
      const files = agentPlugin('drafter', ['tools: Read'], 'BLOCK-DRAFTER body.', {
        SubagentStop: [['^e2e-ag-block:drafter$', hookCommand(rt, 'ag-block-stop', block)]],
      })
      await withPlugins(rt, { 'e2e-ag-block': files }, async () => {
        const { children, parentRuns } = await delegateTurn(rt, 'SubagentStop block', [
          delegateStep('e2e-ag-block:drafter', ['FIRST-DRAFT', 'SECOND-DRAFT']),
          'Reported.',
        ])
        const drafter = childOf(children, 'BLOCK-DRAFTER body.')
        // hooks.md: "Returning `decision: "block"` with a `reason` keeps the subagent running and
        // delivers `reason` to the subagent as its next instruction."
        assert.equal(drafter.length, 2, `the child made ${drafter.length} model requests`)
        assert.ok(heard(drafter[1]).includes('STOP-BLOCK-REASON'), 'the child read the reason')
        assert.ok(heard(parentRuns.at(-1)).includes('SECOND-DRAFT'), 'the parent got the rest')
      })
    },
  },
  {
    name: 'cc-agents: a tool hook fired inside a subagent carries its agent_id and agent_type',
    async run(rt) {
      const files = agentPlugin('runner', ['tools: Bash'], 'ID-RUNNER body.', {
        SubagentStart: [[null, hookCommand(rt, 'ag-id-start')]],
        PreToolUse: [['Bash', hookCommand(rt, 'ag-id-pre')]],
      })
      await withPlugins(rt, { 'e2e-ag-id': files }, async () => {
        await delegateTurn(rt, 'Hook agent_id', [
          delegateStep('e2e-ag-id:runner', [bash('echo ID-RAN'), 'RUNNER-OK']),
          'Reported.',
        ])
        const start = await until(() => hookLog(rt, 'ag-id-start')[0]?.input, 'SubagentStart ran')
        const pre = hookLog(rt, 'ag-id-pre')
          .map((entry) => entry.input)
          .find((input) => input.tool_input?.command === 'echo ID-RAN')
        assert.ok(start && pre, 'SubagentStart and the child’s PreToolUse both ran')
        // hooks.md: "`agent_type` | Agent name ... Present when ... the hook fires inside a
        // subagent"; "`agent_id` | Unique identifier for the subagent ... the hook fires in".
        assert.equal(pre.agent_type, 'e2e-ag-id:runner', JSON.stringify(pre))
        assert.equal(pre.agent_id, start.agent_id)
      })
    },
  },
]
