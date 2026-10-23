import { expect, test } from 'bun:test'
import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import { sessionFixture } from '../../../../testing/session-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CHAT_RUN_PROFILE } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { MiniAppAuthoring } from '../../../plugins/authoring/service'
import type { SessionRecord } from '../../repository'
import { buildOptionalToolPorts } from './runtime-tool-ports'
import type { RuntimeToolWiringContext } from './runtime-tools'

/** A root chat with one agent: the run every case here is about. */
const ROOT_CHAT_POLICY = runPolicyFixture(sessionFixture())

test('plugin_build suggests browser verification only when browser survives the run policy', async () => {
  const authoring = {
    build: async () => ({
      report: { ok: true, published: true, steps: [] },
    }),
  } as unknown as MiniAppAuthoring
  const ctx = {
    deps: {
      db: {},
      ports: { contextStore: {} },
      pluginAuthoring: authoring,
      previewControl: { send: async () => ({}) },
    },
    repo: {},
    memoryRepo: {},
    work: {},
    actionRegistry: {},
  } as unknown as RuntimeToolWiringContext
  const params = {
    userId: 'user-a',
    session: {
      id: 's1',
      projectId: null,
      sessionKind: 'chat',
      provenance: { kind: 'root' },
    } as unknown as SessionRecord,
    agentId: 'agent-a',
    defaultCwd: '/tmp',
    disabledTools: [TOOL.browser],
    agentProfile: {
      ...CHAT_RUN_PROFILE,
      toolExposure: { [TOOL.browser]: 'direct', [TOOL.plugin_build]: 'direct' },
    },
    loadedPlugins: { skills: [] },
    policy: ROOT_CHAT_POLICY,
  } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
  const { optional, ledgerRef } = buildOptionalToolPorts(ctx, params, {} as never)
  expect(optional.browser).toBeDefined()
  expect(optional.plugin_build).toBeDefined()

  ledgerRef.current = new Map([
    [TOOL.browser, { state: 'withheld', reason: { layer: 'policy', kind: 'rule', denial: null } }],
  ])
  const denied = await optional.plugin_build!.run({ name: 'gpu-monitor' })
  expect(denied.text).not.toContain('Before you call it done, look at it')

  ledgerRef.current = new Map([[TOOL.browser, { state: 'live' }]])
  const allowed = await optional.plugin_build!.run({ name: 'gpu-monitor' })
  expect(allowed.text).toContain('Before you call it done, look at it')
})

// The host port reaches the skill tool: a skill the agent saves is announced like an MCP change,
// rather than leaving the capability revision (and so every client's Skills list) where it was.
test('the skill tool announces its save through the host capability port', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tool-ports-skill-'))
  try {
    let announced = 0
    const ctx = {
      deps: { db: {}, ports: { contextStore: {} }, announceCapabilityChange: () => announced++ },
      repo: {},
      memoryRepo: {},
      work: {},
      actionRegistry: {},
    } as unknown as RuntimeToolWiringContext
    const params = {
      userId: 'user-a',
      session: {
        id: 's1',
        projectId: null,
        sessionKind: 'chat',
        provenance: { kind: 'root' },
      } as unknown as SessionRecord,
      agentId: 'agent-a',
      defaultCwd: dir,
      disabledTools: [],
      agentProfile: { ...CHAT_RUN_PROFILE, toolExposure: { [TOOL.skill]: 'direct' } },
      loadedPlugins: { skills: [] },
      policy: ROOT_CHAT_POLICY,
    } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
    const { optional } = buildOptionalToolPorts(ctx, params, {} as never)
    const input = { action: 'save', name: 'zz-port-skill', description: 'd', content: 'c' }
    await optional.skill!.execute('t', input as never)
    expect(announced).toBe(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('set_topic is offered exactly when the host built its port', () => {
  const ctx = {
    deps: { db: {}, ports: { contextStore: {} } },
    repo: {},
    memoryRepo: {},
    work: {},
    actionRegistry: {},
  } as unknown as RuntimeToolWiringContext
  const port = { save: async () => {} }
  for (const setTopic of [port, undefined]) {
    const params = {
      userId: 'u',
      session: { id: 's', sessionKind: 'chat', agents: [], provenance: { kind: 'root' } },
      agentId: 'a',
      defaultCwd: '/tmp',
      disabledTools: [],
      agentProfile: CHAT_RUN_PROFILE,
      loadedPlugins: { skills: [] },
      setTopic,
      policy: ROOT_CHAT_POLICY,
    } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
    const { optional } = buildOptionalToolPorts(ctx, params, {} as never)
    expect(optional.set_topic).toBe(setTopic)
  }
})
