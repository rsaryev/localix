import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CHAT_RUN_PROFILE } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { PluginAuthoring } from '../../../plugins/authoring/service'
import type { SessionRecord } from '../../repository'
import { buildOptionalToolPorts } from './runtime-tool-ports'
import type { RuntimeToolWiringContext } from './runtime-tools'

test('plugin_build suggests browser verification only when browser survives the run policy', async () => {
  const authoring = {
    build: async () => ({
      report: { ok: true, published: true, steps: [] },
    }),
  } as unknown as PluginAuthoring
  const ctx = {
    deps: {
      db: {},
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
      deps: { db: {}, announceCapabilityChange: () => announced++ },
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
    } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
    const { optional } = buildOptionalToolPorts(ctx, params, {} as never)
    const input = { action: 'save', name: 'zz-port-skill', description: 'd', content: 'c' }
    await optional.skill!.execute('t', input as never)
    expect(announced).toBe(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('topic schema is offered only to the elected chat owner, including a fixed solo chat', async () => {
  const { createConversationControlTool } =
    await import('../../../agent-core/tools/conversation-control')
  const ctx = {
    deps: { db: {} },
    repo: {},
    memoryRepo: {},
    work: {},
    actionRegistry: {},
  } as unknown as RuntimeToolWiringContext
  for (const [kind, agents, canChangeTopic] of [
    ['chat', [{ agentId: 'a' }, { agentId: 'b' }], true],
    ['chat', [{ agentId: 'a' }, { agentId: 'b' }], false],
    ['chat', [{ agentId: 'a' }], true],
    ['subagent', [{ agentId: 'a' }, { agentId: 'b' }], true],
  ] as const) {
    const params = {
      userId: 'u',
      session: {
        id: 's',
        sessionKind: kind,
        agents,
        rosterLocked: true,
        provenance: { kind: 'root' },
      },
      agentId: 'a',
      defaultCwd: '/tmp',
      disabledTools: [],
      agentProfile: CHAT_RUN_PROFILE,
      loadedPlugins: { skills: [] },
      canChangeTopic,
      conversationControl: async () => ({ invited: [], removed: [], next: [] }),
    } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
    const { optional } = buildOptionalToolPorts(ctx, params, {} as never)
    const tool = createConversationControlTool(optional.conversation_control!)
    const request = {
      next: [],
      topic: { title: 'Release', goal: 'Ship it', previousTopicSummary: 'Tests passed' },
    }
    expect(tool.inputSchema.safeParse(request).success).toBe(kind === 'chat' && canChangeTopic)
  }
})
