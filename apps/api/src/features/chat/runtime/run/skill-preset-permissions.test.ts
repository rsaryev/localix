import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENT_NAME } from '../../../../db/author'
import { builtinAgentPreset } from '../../../capabilities/builtin-agent-presets'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from '../../../capabilities/resolve'
import { applyPermissionMode } from '../../../capabilities/permission-mode-policy'
import { createReadTool } from '../../../agent-core/tools/file/read'
import { evaluate, extractCallFacts } from '../../../agent-core/permission-engine'
import { withAllowedTools } from './permission-gate-build'
import { runOuterRules } from './claude-code-permissions'
import { createPermissionGate } from '../../../agent-core/permission-gate'
import { withOuterRules } from '../../../agent-core/permission-verdict'
import type { PermissionRule, ToolFacts } from '../../../agent-core/permission-engine'

const root = '/workspace'
const grants = withAllowedTools(runOuterRules(root, '/home/me'), ['Bash(git *)', 'Read'])
/** The list's decision with the skill's grants applied, as the gate composes them. */
const granted = (rules: readonly PermissionRule[], tool: ToolFacts, input: object) =>
  withOuterRules(
    evaluate(rules, tool, extractCallFacts(tool.name, input, root)),
    grants.judge({ toolName: tool.name, input, tool: undefined }),
  ).action
const permissions = (name: string) =>
  projectCapabilities(composeCapabilities(builtinAgentPreset(name)), NO_ROSTERS).permissions

describe('shipped presets with task-local skill preapprovals', () => {
  test.each([DEFAULT_AGENT_NAME])('%s retains its allowlist and argument guards', async (name) => {
    const rules = permissions(name)
    const read = createReadTool(undefined, root)
    const gate = createPermissionGate({
      rules,
      outerRules: grants,
      root,
      hostRoots: [],
      toolsByName: new Map([[read.name, read]]),
    })
    expect(
      (await gate({ toolCallId: 'inside', toolName: 'Read', input: { path: 'source.ts' } }))?.block,
    ).not.toBe(true)
    expect(
      await gate({ toolCallId: 'outside', toolName: 'Read', input: { path: '/elsewhere/a.ts' } }),
    ).toMatchObject({ block: true })
    expect(
      granted(
        rules,
        { name: 'Bash', effect: 'external' },
        { command: 'git push --force origin main' },
      ),
    ).toBe('ask')
  })

  test('a skill cannot reopen a denied tool or a class denied by plan mode', () => {
    const mode = applyPermissionMode('plan', [
      ...builtinAgentPreset('localix'),
      { action: 'tool:Read', resource: '*', effect: 'deny' },
    ])
    const rules = projectCapabilities(composeCapabilities(mode.rules), NO_ROSTERS).permissions
    expect(granted(rules, { name: 'Read', effect: 'read' }, { path: 'a' })).toBe('deny')
    expect(granted(rules, { name: 'Bash', effect: 'external' }, { command: 'git status' })).toBe(
      'deny',
    )
  })

  test('a skill grant answers only the catch-all question; an authored named ask still asks', () => {
    // skills.md: "Deny and ask rules still override allowed-tools".
    const rules = [
      { permission: 'Bash', pattern: '*', action: 'deny' as const },
      { permission: 'Bash', pattern: 'git *', action: 'ask' as const },
    ]
    const gitStatus = { command: 'git status' }
    const bash = { name: 'Bash', effect: 'read' as const }
    expect(granted(rules, bash, gitStatus)).toBe('ask')
    const catchAll = [{ permission: '*', pattern: '*', action: 'ask' as const }]
    expect(granted(catchAll, bash, gitStatus)).toBe('allow')
    expect(granted(rules, { name: 'Bash', effect: 'external' }, { command: 'npm publish' })).toBe(
      'deny',
    )
  })
})
