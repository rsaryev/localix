import { describe, expect, test } from 'bun:test'
import { BUILTIN_TEAM } from '../../../agents/builtin-team'
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
const permissions = (handle: string) =>
  projectCapabilities(composeCapabilities(builtinAgentPreset(handle)), NO_ROSTERS).permissions

describe('shipped presets with task-local skill preapprovals', () => {
  test.each(BUILTIN_TEAM.map((agent) => agent.handle))(
    '%s retains its allowlist and argument guards',
    async (handle) => {
      const rules = permissions(handle)
      const read = createReadTool(undefined, root)
      const gate = createPermissionGate({
        rules,
        preapprovedRules: grants,
        root,
        hostRoots: [],
        toolsByName: new Map([[read.name, read]]),
      })
      expect(
        (await gate({ toolCallId: 'inside', toolName: 'read', input: { path: 'source.ts' } }))
          ?.block,
      ).not.toBe(true)
      expect(
        await gate({ toolCallId: 'outside', toolName: 'read', input: { path: '/elsewhere/a.ts' } }),
      ).toMatchObject({ block: true })
      expect(
        evaluate(
          rules,
          { name: 'bash', effect: 'external' },
          extractCallFacts('bash', { command: 'git push --force origin main' }, root),
          grants,
        ).action,
      ).toBe('ask')
    },
  )

  test('a skill cannot reopen a denied tool or a class denied by plan mode', () => {
    const mode = applyPermissionMode('plan', [
      ...builtinAgentPreset('localix'),
      { action: 'tool:read', resource: '*', effect: 'deny' },
    ])
    const rules = projectCapabilities(composeCapabilities(mode.rules), NO_ROSTERS).permissions
    expect(
      evaluate(
        rules,
        { name: 'read', effect: 'read' },
        extractCallFacts('read', { path: 'a' }, root),
        grants,
      ).action,
    ).toBe('deny')
    expect(
      evaluate(
        rules,
        { name: 'bash', effect: 'external' },
        extractCallFacts('bash', { command: 'git status' }, root),
        grants,
      ).action,
    ).toBe('deny')
  })

  test('the authored exception to an earlier denial remains effective', () => {
    const rules = [
      { permission: 'bash', pattern: '*', action: 'deny' as const },
      { permission: 'bash', pattern: 'git *', action: 'ask' as const },
    ]
    expect(
      evaluate(
        rules,
        { name: 'bash', effect: 'read' },
        extractCallFacts('bash', { command: 'git status' }, root),
        grants,
      ).action,
    ).toBe('allow')
    expect(
      evaluate(
        rules,
        { name: 'bash', effect: 'external' },
        extractCallFacts('bash', { command: 'npm publish' }, root),
        grants,
      ).action,
    ).toBe('deny')
  })
})
