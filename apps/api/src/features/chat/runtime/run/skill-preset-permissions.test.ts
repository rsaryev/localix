import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENT_NAME } from '../../../../db/author'
import { builtinAgentPreset } from '../../../capabilities/builtin-agent-presets'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from '../../../capabilities/resolve'
import { applyPermissionMode } from '../../../capabilities/permission-mode-policy'
import { createReadTool } from '../../../agent-core/tools/file/read'
import {
  createPermissionGate,
  evaluate,
  extractCallFacts,
} from '../../../agent-core/permission-engine'
import { skillPermissionRules } from './permission-gate-build'

const root = '/workspace'
const grants = skillPermissionRules(['Bash(git *)', 'Read'])
const permissions = (name: string) =>
  projectCapabilities(composeCapabilities(builtinAgentPreset(name)), NO_ROSTERS).permissions

describe('shipped presets with task-local skill preapprovals', () => {
  test.each([DEFAULT_AGENT_NAME])('%s retains its allowlist and argument guards', async (name) => {
    const rules = permissions(name)
    const read = createReadTool(undefined, root)
    const gate = createPermissionGate({
      rules,
      preapprovedRules: grants,
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
      evaluate(
        rules,
        { name: 'Bash', effect: 'external' },
        extractCallFacts('Bash', { command: 'git push --force origin main' }, root),
        grants,
      ).action,
    ).toBe('ask')
  })

  test('a skill cannot reopen a denied tool or a class denied by plan mode', () => {
    const mode = applyPermissionMode('plan', [
      ...builtinAgentPreset('localix'),
      { action: 'tool:Read', resource: '*', effect: 'deny' },
    ])
    const rules = projectCapabilities(composeCapabilities(mode.rules), NO_ROSTERS).permissions
    expect(
      evaluate(
        rules,
        { name: 'Read', effect: 'read' },
        extractCallFacts('Read', { path: 'a' }, root),
        grants,
      ).action,
    ).toBe('deny')
    expect(
      evaluate(
        rules,
        { name: 'Bash', effect: 'external' },
        extractCallFacts('Bash', { command: 'git status' }, root),
        grants,
      ).action,
    ).toBe('deny')
  })

  test('a skill grant answers only the catch-all question; an authored named ask still asks', () => {
    // skills.md: "Deny and ask rules still override allowed-tools".
    const rules = [
      { permission: 'Bash', pattern: '*', action: 'deny' as const },
      { permission: 'Bash', pattern: 'git *', action: 'ask' as const },
    ]
    const gitStatus = extractCallFacts('Bash', { command: 'git status' }, root)
    const bash = { name: 'Bash', effect: 'read' as const }
    expect(evaluate(rules, bash, gitStatus, grants).action).toBe('ask')
    const catchAll = [{ permission: '*', pattern: '*', action: 'ask' as const }]
    expect(evaluate(catchAll, bash, gitStatus, grants).action).toBe('allow')
    expect(
      evaluate(
        rules,
        { name: 'Bash', effect: 'external' },
        extractCallFacts('Bash', { command: 'npm publish' }, root),
        grants,
      ).action,
    ).toBe('deny')
  })
})
