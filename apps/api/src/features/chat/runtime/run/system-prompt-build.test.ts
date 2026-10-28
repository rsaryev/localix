import { activeDescendantSubagents } from './descendant-roster'
import { describe, expect, test } from 'bun:test'
import { resolveRunProfile } from '../../../agent-core/run-shape'

const SHAPE = { subagent: resolveRunProfile({ sessionKind: 'subagent' }) }
import { createRuntimeToolRegistry, onTheWire } from '../../../agent-core/tool-registry'
import type { SessionRecord } from '../../repository'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { RunSessionSnapshotRow } from './session-snapshot'
import { buildRunSystemPrompt } from './system-prompt-build'
import { channelNameFromSourceKey } from '../../policy/axes/delivery'
import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import { buildPluginsPromptContext } from './plugins-prompt-context'
import { buildMiniAppsPromptContext } from './mini-apps-prompt-context'
import { emptyLoadedMiniApps, type LoadedMiniApps } from '../../../mini-apps/loader-contract'
import { routedAgent, sessionFixture } from '../../../../testing/session-fixture'

const session = (
  id: string,
  parentSessionId: string | null,
  runtimeStatus: SessionRecord['runtimeStatus'] = 'running',
  title = id,
): RunSessionSnapshotRow =>
  ({
    id,
    userId: 'user-a',
    parentSessionId,
    runtimeStatus,
    title,
    sessionKind: 'subagent',
  }) as RunSessionSnapshotRow

describe('activeDescendantSubagents', () => {
  test('shows the whole subtree below the reader, in pre-order, with stable session ids', () => {
    const sessions = [
      session('a', 'root'),
      session('done', 'root', 'completed'),
      session('nested', 'a'),
      session('under-done', 'done'),
      { ...session('job', 'root'), sessionKind: 'job' as const },
    ]

    expect(activeDescendantSubagents(sessions, 'root')).toEqual([
      { title: 'a [running]', task: 'a' },
      { title: '↳ nested [running]', task: 'nested' },
      { title: '↳ under-done [running]', task: 'under-done' },
    ])
    // A child sees below itself and never above: not the root, not its siblings.
    expect(activeDescendantSubagents(sessions, 'a')).toEqual([
      { title: 'nested [running]', task: 'nested' },
    ])
  })

  test('breaks malformed parent cycles instead of recursing forever', () => {
    const a = session('a', 'root')
    const b = session('root', 'a')
    expect(activeDescendantSubagents([a, b], 'root')).toHaveLength(2)
  })
})

describe('channelNameFromSourceKey', () => {
  test('returns the channel segment rather than the plugin segment', () => {
    expect(channelNameFromSourceKey('channel:sample-bridge:direct:chat-42')).toBe('direct')
  })

  test('ignores non-channel and malformed provenance keys', () => {
    expect(channelNameFromSourceKey('delegate:tool-1')).toBeUndefined()
    expect(channelNameFromSourceKey('channel:sample-bridge')).toBeUndefined()
    expect(channelNameFromSourceKey(null)).toBeUndefined()
  })

  test('does not let colons inside the conversation id shift the channel', () => {
    expect(channelNameFromSourceKey('channel:discord:thread:guild:room:message')).toBe('thread')
  })
})

describe('buildPluginsPromptContext', () => {
  test('lists LSP contributions by extension, with a missing binary and its install hint', () => {
    const loadedPlugins = {
      loaded: [],
      promptSections: [],
      lspServers: [
        {
          pluginName: 'typescript-lsp',
          servers: {
            typescript: {
              command: 'typescript-language-server',
              extensionToLanguage: { '.ts': 'typescript', '.zzz': 'zzz' },
            },
          },
        },
      ],
    } as unknown as LoadedPlugins
    const out = buildPluginsPromptContext(loadedPlugins, [])!
    expect(out).toContain('- typescript-lsp — LSP "typescript": .zzz; built-in server kept for .ts')
    expect(out).toContain('diagnostics via edit/write results, not a tool')
  })

  test('indexes a plugin by the skills it offers, without repeating manifest descriptions', () => {
    const loadedPlugins = {
      loaded: [
        {
          name: 'actionable',
          scope: 'global',
          description: 'A long manifest description already represented by its skills.',
          skills: ['review'],
          mcpServers: [],
        },
        {
          name: 'ui-only',
          scope: 'global',
          description: 'Theme and command contributions only.',
          skills: [],
          mcpServers: [],
        },
      ],
    } as unknown as LoadedPlugins

    const out = buildPluginsPromptContext(loadedPlugins, ['Skill', 'agents'])!

    expect(out).toContain('- actionable — 1 skill')
    expect(out).not.toContain('ui-only')
    expect(out).not.toContain('manifest description')
  })
})

describe('buildMiniAppsPromptContext', () => {
  test('indexes only the tools on the wire, and the prompt sections apps declare', () => {
    const loadedMiniApps = {
      loaded: [
        {
          name: 'actionable',
          scope: 'global',
          description: 'A long manifest description already represented by its tool schema.',
          toolNames: ['app_lookup', 'disabled_app_tool'],
        },
        { name: 'screens-only', scope: 'global', description: 'Screens only.', toolNames: [] },
      ],
      guides: [],
      promptSections: [
        { app: 'policy', title: 'Guardrails', content: 'Keep this explicit policy.' },
      ],
    } as unknown as LoadedMiniApps

    const out = buildMiniAppsPromptContext(loadedMiniApps, ['app_lookup'])!

    expect(out).toContain('- actionable — 1 direct tool')
    expect(out).toContain('## policy: Guardrails')
    expect(out).toContain('Keep this explicit policy.')
    expect(out).not.toContain('screens-only')
    expect(out).not.toContain('manifest description')
    expect(out).not.toContain('disabled_app_tool')
  })

  test('counts a deferred mini app tool as one to activate, never as direct', () => {
    // Mini app tools wait behind `ToolSearch` until the session activates them; this index
    // used to call every one of them direct.
    const loadedMiniApps = {
      loaded: [
        {
          name: 'acme',
          scope: 'global',
          description: '',
          toolNames: ['acme_query', 'acme_migrate'],
        },
      ],
      guides: [],
      promptSections: [],
    } as unknown as LoadedMiniApps
    const out = buildMiniAppsPromptContext(
      loadedMiniApps,
      ['acme_query'],
      new Set(['acme_migrate']),
    )!
    expect(out).toContain('- acme — 1 direct tool; 1 tool to activate')
  })

  test('a mini app with a guide says so, and how to read it, while the guide tool is on', () => {
    const loadedMiniApps = {
      loaded: [
        { name: 'tiles', scope: 'global', toolNames: ['tiles'] },
        { name: 'notes', scope: 'global', toolNames: ['notes'] },
      ],
      guides: [{ app: 'tiles', file: '/apps/tiles/guide.md' }],
      promptSections: [],
    } as unknown as LoadedMiniApps

    const out = buildMiniAppsPromptContext(loadedMiniApps, ['tiles', 'notes', 'MiniAppGuide'])!
    expect(out).toContain('- tiles — 1 direct tool; guide')
    expect(out).toContain('- notes — 1 direct tool\n')
    expect(out).toContain('MiniAppGuide')
    // Without the tool on the wire, a guide is nothing the model can act on.
    const without = buildMiniAppsPromptContext(loadedMiniApps, ['tiles', 'notes'])!
    expect(without).not.toContain('guide')
  })
})

describe('the run tools', () => {
  test('the run holds only what deferral left on the wire', () => {
    const registry = {
      tools: [],
      toolNames: ['Read', 'acme_query', 'acme_migrate'],
      ledger: new Map(),
    } as unknown as Parameters<typeof onTheWire>[0]
    const wire = onTheWire(registry, [
      { name: 'Read', modelName: 'Read' },
      { name: 'acme_query' },
      { name: 'ToolSearch', modelName: 'ToolSearch' },
    ])
    expect(wire.toolNames).toEqual(['Read', 'acme_query', 'ToolSearch'])
    // No wire list (a caller outside a run) leaves the registry as it is.
    expect(onTheWire(registry, undefined)).toBe(registry)
  })

  test('returns no prompt context for plugins with no model-facing contribution', () => {
    const loadedPlugins = {
      loaded: [
        {
          name: 'commands-only',
          scope: 'global',
          description: 'Commands only',
          skills: ['hidden-without-skill-tool'],
          mcpServers: [],
        },
      ],
      agents: [],
      promptSections: [],
    } as unknown as LoadedPlugins

    expect(buildPluginsPromptContext(loadedPlugins, [])).toBeUndefined()
  })
})

describe('buildRunSystemPrompt pinned skills', () => {
  test('the agent receives the live session topic in its runtime context', async () => {
    const chat = sessionFixture({
      title: 'Release',
      goal: 'Ship the parser.',
      previousTopicSummary: 'Keep Bun; parser tests passed.',
      agent: {
        agentId: 'lead',
        name: 'lead',
        modelId: '',
        providerConnectionId: null,
        reasoningEffort: 'medium',
      },
    })
    const agentProfile = resolveRunProfile({ sessionKind: 'chat' })
    const runtimeTools = createRuntimeToolRegistry({ policy: { agentProfile } })
    const build = (current: SessionRecord, agentId: string) =>
      buildRunSystemPrompt({
        userId: current.userId,
        session: current,
        agentId,
        policy: runPolicyFixture(current),
        providerId: 'test',
        agentProfile,
        runtimeTools,
        loadedPlugins: { loaded: [], agents: [], outputStyles: [] } as unknown as LoadedPlugins,
        loadedMiniApps: emptyLoadedMiniApps(),
        frozenContext: {},
        pinnedSkills: [],
        triggeredSkills: [],
        contextFiles: [],
        defaultCwd: '/tmp',
        scratchDir: '/tmp/localix-test',
        childRuntimeSessions: new Map(),
        now: () => '2026-10-08',
      })
    // The objective is one session's own, so it rides the tail: a system prompt that held it would
    // differ from every other session's, and a new objective would rewrite the history after it.
    const tailOf = (built: Awaited<ReturnType<typeof build>>) =>
      built.runtimeSections.map((s) => s.text).join('\n')
    for (const agent of [chat.agent!]) {
      const built = await build(chat, agent.agentId)
      expect(tailOf(built)).toContain(chat.goal!)
      expect(tailOf(built)).toContain(chat.previousTopicSummary!)
      expect(built.systemPrompt).not.toContain('# Session objective')
      expect(built.systemPrompt).not.toContain(chat.goal!)
    }
    const next = await build({ ...chat, goal: 'Deploy the parser.' }, 'lead')
    expect(tailOf(next)).toContain('Deploy the parser.')
    expect(tailOf(next)).not.toContain(chat.goal!)
    expect(tailOf(next)).toContain(chat.previousTopicSummary!)
  })

  test("a chat with no style of its own speaks in the person's default style; `default` opts out", async () => {
    const agentProfile = resolveRunProfile({ sessionKind: 'chat' })
    const runtimeTools = createRuntimeToolRegistry({ policy: { agentProfile } })
    const build = (outputStyle: string | null) => {
      const chat = { ...sessionFixture(), outputStyle }
      const answeringAgent = chat.agent!.agentId
      return buildRunSystemPrompt({
        userId: chat.userId,
        session: chat,
        agentId: answeringAgent,
        policy: runPolicyFixture(chat),
        providerId: 'test',
        agentProfile,
        runtimeTools,
        loadedPlugins: { loaded: [], agents: [], outputStyles: [] } as unknown as LoadedPlugins,
        loadedMiniApps: emptyLoadedMiniApps(),
        frozenContext: {},
        pinnedSkills: [],
        triggeredSkills: [],
        contextFiles: [],
        defaultCwd: '/',
        scratchDir: '/tmp/localix-test',
        childRuntimeSessions: new Map(),
        now: () => '2026-10-08',
        defaultOutputStyle: 'Explanatory',
      })
    }
    const tailOf = (built: Awaited<ReturnType<typeof build>>) =>
      built.runtimeSections.map((section) => section.text).join('\n')
    expect(tailOf(await build(null))).toContain(
      'This conversation uses the "Explanatory" output style.',
    )
    expect(tailOf(await build('default'))).not.toContain('# Output style')
  })

  test('keeps inline pinned instructions when the runtime has no skill tool', async () => {
    const runtimeTools = createRuntimeToolRegistry({
      policy: { agentProfile: SHAPE.subagent },
    })
    expect(runtimeTools.toolNames).not.toContain('Skill')
    const loadedPlugins = { loaded: [], agents: [] } as unknown as LoadedPlugins
    const agent = routedAgent()
    const session = {
      id: 'sub',
      sessionKind: 'subagent',
      projectId: null,
      modelId: null,
      sourceToolCallId: null,
      parentSessionId: 'root',
      provenance: { kind: 'unknown-origin' },
      agent,
    } as unknown as SessionRecord
    const built = await buildRunSystemPrompt({
      userId: 'u',
      session,
      agentId: agent.agentId,
      policy: runPolicyFixture(session),
      providerId: 'test',
      agentProfile: SHAPE.subagent,
      runtimeTools,
      loadedPlugins,
      loadedMiniApps: emptyLoadedMiniApps(),
      frozenContext: {},
      pinnedSkills: [{ name: 'review', content: 'Always inspect the final diff.' }],
      // Empty, not absent: this case is about a PINNED skill, and a run with nothing triggered
      // is the ordinary state rather than a missing input.
      triggeredSkills: [],
      contextFiles: [],
      defaultCwd: '/tmp',
      scratchDir: '/tmp/localix-test',
      childRuntimeSessions: new Map(),
      now: () => '2026-07-22T00:00:00.000Z',
    })

    const tail = built.runtimeSections.map((section) => section.text).join('\n')
    expect(tail).toContain('# Active skills (applied to this session)')
    expect(tail).toContain('Always inspect the final diff.')
    expect(tail).not.toContain('# Available skills')
  })
})

describe('the system prompt across two turns of one conversation', () => {
  test('is the same bytes when only what moves under the agent has changed', async () => {
    const agentProfile = resolveRunProfile({ sessionKind: 'chat' })
    const runtimeTools = createRuntimeToolRegistry({ policy: { agentProfile } })
    const chat = sessionFixture({ title: 'Release', goal: 'Ship the parser.' })
    const answeringAgent = chat.agent!.agentId
    const build = (volatile: Partial<Parameters<typeof buildRunSystemPrompt>[0]>) =>
      buildRunSystemPrompt({
        userId: chat.userId,
        session: chat,
        agentId: answeringAgent,
        policy: runPolicyFixture(chat),
        providerId: 'test',
        agentProfile,
        runtimeTools,
        loadedPlugins: { loaded: [], agents: [], outputStyles: [] } as unknown as LoadedPlugins,
        loadedMiniApps: emptyLoadedMiniApps(),
        frozenContext: {},
        pinnedSkills: [],
        triggeredSkills: [],
        contextFiles: [],
        defaultCwd: '/tmp',
        scratchDir: '/tmp/localix-test',
        childRuntimeSessions: new Map(),
        now: () => '2026-10-08',
        ...volatile,
      })
    const first = await build({})
    // A day later, a job started, a server connected, a child at work and a turn's own trigger.
    const second = await build({
      now: () => '2026-10-09',
      backgroundJobs: [
        { jobId: 'j1', command: 'bun test', startedAt: 1, output: 'ok', running: true },
      ],
      mcpInventory: [{ server: 'docs', tools: ['Search'] }],
      mcpInstructions: [{ server: 'docs', text: 'Prefer search.' }],
      descendantSessions: [
        {
          id: 'child',
          userId: chat.userId,
          parentSessionId: chat.id,
          runtimeStatus: 'running',
          title: 'Indexing',
          sessionKind: 'subagent',
        } as RunSessionSnapshotRow,
      ],
      triggeredSkills: [{ name: 'review', keyword: 'review', content: 'Inspect the diff.' }],
    })

    expect(second.systemPrompt).toBe(first.systemPrompt)
    // What changed rides the turn's runtime context in the conversation, after everything cached.
    const tail = second.runtimeSections.map((section) => section.text).join('\n')
    expect(tail).toContain('bun test')
    expect(tail).toContain('Indexing')
    expect(tail).toContain('Inspect the diff.')
    expect(first.runtimeSections.map((section) => section.text).join('\n')).not.toContain(
      'bun test',
    )
  })
})
