import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'
import { z } from 'zod'

import {
  evaluate,
  extractCallFacts,
  type PermissionRule,
} from '../../../agent-core/permission-engine'
import { buildRunPermissionGate, skillPermissionRules } from './permission-gate-build'
import type { SessionRecord } from '../../repository'
import type { RunEnv } from './types'
import type { CcHooksRuntime } from '../../../cc-hooks'
import { createWriteTool } from '../../../agent-core/tools/file/write'

const tool = { name: 'bash', effect: 'external' as const }
const root = '/tmp/workspace'

function unattendedGate(
  tools: readonly AgentTool[],
  rules: PermissionRule[] = [],
  session = { id: 'job', sessionKind: 'job' } as SessionRecord,
) {
  return buildRunPermissionGate({
    tools,
    session,
    agentId: 'agent',
    env: {} as RunEnv,
    ccHooks: {} as CcHooksRuntime,
    userId: 'user',
    hitlTargetSessionId: null,
    assistantMessageId: 'message',
    abortSignal: new AbortController().signal,
    pluginHooksForRun: [],
    hookRunOptions: { sessionId: 'job', logger: { warn: () => {} } },
    extraAllowedTools: undefined,
    permissionRules: rules,
    defaultCwd: root,
  })
}

describe('assembled dispatch permissions', () => {
  const external: AgentTool = {
    name: 'mcp__records__manage',
    description: 'Manage records',
    activeVerb: 'Managing records',
    inputSchema: z.unknown(),
    execute: async () => ({ content: '' }),
    mutates: true,
  }
  const call = { toolCallId: 'call', toolName: external.name, input: {} }

  // Confirm-every-mutation is an ordinary rule now (it used to be what `ask` mode injected),
  // so the gate is handed one rather than a mode.
  const confirmMutations: PermissionRule[] = [
    { permission: '*', pattern: 'mutates', action: 'ask' },
  ]

  test('a late registered tool is judged on its own declaration under a confirm-mutations rule', async () => {
    // A tool the gate was never handed declares nothing, so it is judged `external` —
    // fail-closed — and confirms. The registered declaration is what the gate reads: the same
    // name declared a pure reader passes, declared a writer confirms.
    expect(await unattendedGate([], confirmMutations)(call)).toMatchObject({ block: true })
    expect(
      await unattendedGate([{ ...external, mutates: false }], confirmMutations)(call),
    ).toBeUndefined()
    expect(await unattendedGate([external], confirmMutations)(call)).toMatchObject({ block: true })
  })

  test('deferred implementation classifiers retain read/write separation', async () => {
    const gate = unattendedGate(
      [
        {
          ...external,
          classify: (input) => ({ effect: input === 'inspect' ? 'read' : 'external' }),
        },
      ],
      confirmMutations,
    )
    expect(await gate({ ...call, input: 'inspect' })).toBeUndefined()
    expect(await gate({ ...call, input: 'delete' })).toMatchObject({ block: true })
  })

  test('late registered resource declarations participate in scoped policy', async () => {
    const rules: PermissionRule[] = [
      { permission: external.name, pattern: 'record:private', action: 'deny' },
    ]
    const gate = unattendedGate(
      [{ ...external, permissionResources: (input) => [String(input)] }],
      rules,
    )
    expect(await gate({ ...call, input: 'record:public' })).toBeUndefined()
    expect(await gate({ ...call, input: 'record:private' })).toMatchObject({ block: true })
  })
})

describe('the run’s own plan directory', () => {
  // Plan mode's refusal of file writes; the plan file is `session` state only for its own run.
  const planMode: PermissionRule[] = [{ permission: '*', pattern: 'effect:files', action: 'deny' }]
  const write = createWriteTool(undefined, root)
  const writeTo = (path: string) => ({
    toolCallId: 'call',
    toolName: 'write',
    input: { path, content: '# Plan' },
  })
  const rootRun = { id: 'r', seq: 7, parentSessionId: null, sessionKind: 'job' } as SessionRecord
  const childRun = { ...rootRun, id: 'c', seq: 8, parentSessionId: 'r' } as SessionRecord

  test('a root run writes its own conversation’s plan, never another’s', async () => {
    const gate = unattendedGate([write], planMode, rootRun)
    expect(await gate(writeTo('.localix/plans/LOCALIX-7/PLAN.md'))).toBeUndefined()
    expect(await gate(writeTo('.localix/plans/LOCALIX-8/PLAN.md'))).toMatchObject({ block: true })
  })

  test('a delegated run writes no plan file, its root’s included', async () => {
    const gate = unattendedGate([write], planMode, childRun)
    expect(await gate(writeTo('.localix/plans/LOCALIX-7/PLAN.md'))).toMatchObject({ block: true })
  })
})

describe('skill preapprovals', () => {
  test('CC colon prefixes preserve command word boundaries and compound safety', () => {
    const rules: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'ask' }]
    const grants = skillPermissionRules(['Bash(git status:*)'])
    for (const command of ['git status', 'git status --short']) {
      expect(
        evaluate(rules, tool, extractCallFacts('bash', { command }, root), grants).action,
      ).toBe('allow')
    }
    for (const command of ['git status-malicious', 'git status && npm publish']) {
      expect(
        evaluate(rules, tool, extractCallFacts('bash', { command }, root), grants).action,
      ).toBe('ask')
    }
  })
  test('skill allowed-tools overrides ask for its command family, not unrelated commands', () => {
    const rules: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'ask' }]
    const grants = skillPermissionRules(['Bash(git *)'])

    expect(
      evaluate(rules, tool, extractCallFacts('bash', { command: 'git status' }, root), grants)
        .action,
    ).toBe('allow')
    expect(
      evaluate(rules, tool, extractCallFacts('bash', { command: 'npm publish' }, root), grants)
        .action,
    ).toBe('ask')
  })

  test('an agent deny survives a skill that declares an allow covering it', () => {
    const projectRules: PermissionRule[] = [
      {
        permission: 'bash',
        pattern: 'git push*',
        action: 'deny',
        message: 'Do not push from this project.',
      },
    ]
    const grants = skillPermissionRules(['Bash(git *)'])

    expect(
      evaluate(
        projectRules,
        tool,
        extractCallFacts('bash', { command: 'git push origin main' }, root),
        grants,
      ).action,
    ).toBe('deny')
  })
})
