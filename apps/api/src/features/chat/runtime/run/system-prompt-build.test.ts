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
import { routedParticipants, sessionFixture } from '../../../../testing/session-fixture'

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

  test('indexes only model-actionable contributions without repeating manifest descriptions', () => {
    const loadedPlugins = {
      loaded: [
        {
          name: 'actionable',
          scope: 'global',
          description: 'A long manifest description already represented by its tool schema.',
          toolNames: ['plugin_lookup', 'disabled_plugin_tool'],
          skills: ['review'],
          mcpServers: [],
        },
        {
          name: 'ui-only',
          scope: 'global',
          description: 'Theme and command contributions only.',
          toolNames: [],
          skills: [],
          mcpServers: [],
        },
      ],
      agents: [{ pluginName: 'actionable' }],
      promptSections: [
        { pluginName: 'policy', title: 'Guardrails', content: 'Keep this explicit policy.' },
      ],
    } as unknown as LoadedPlugins

    const out = buildPluginsPromptContext(loadedPlugins, ['plugin_lookup', 'skill', 'agents'])!

    expect(out).toContain('- actionable — 1 direct tool; 1 skill')
    expect(out).toContain('## policy: Guardrails')
    expect(out).toContain('Keep this explicit policy.')
    expect(out).not.toContain('ui-only')
    expect(out).not.toContain('manifest description')
    expect(out).not.toContain('disabled_plugin_tool')
  })

  test('counts a deferred plugin tool as one to activate, never as direct', () => {
    // Plugin tools wait behind `activate_tools` until the session activates them; this index
    // used to call every one of them direct.
    const loadedPlugins = {
      loaded: [
        {
          name: 'acme',
          scope: 'global',
          description: '',
          toolNames: ['acme_query', 'acme_migrate'],
          skills: [],
          mcpServers: [],
        },
      ],
      agents: [],
      promptSections: [],
    } as unknown as LoadedPlugins
    const out = buildPluginsPromptContext(loadedPlugins, ['acme_query'], new Set(['acme_migrate']))!
    expect(out).toContain('- acme — 1 direct tool; 1 tool to activate')
  })

  test('the roster lists only what deferral left on the wire', () => {
    const registry = {
      tools: [],
      toolNames: ['read', 'acme_query', 'acme_migrate'],
      promptSection: '',
      ledger: new Map(),
    } as unknown as Parameters<typeof onTheWire>[0]
    const wire = onTheWire(registry, ['read', 'acme_query', 'activate_tools'])
    expect(wire.promptSection).toBe('# Available tools\n- read\n- acme_query\n- activate_tools')
    expect(wire.toolNames).not.toContain('acme_migrate')
    // No wire list (a caller outside a run) leaves the registry's own roster.
    expect(onTheWire(registry, undefined)).toBe(registry)
  })

  test('a mini app with a guide says so, and how to read it, while the guide tool is on', () => {
    const loadedPlugins = {
      loaded: [
        { name: 'chess', scope: 'global', toolNames: ['chess'], skills: [], mcpServers: [] },
        { name: 'notes', scope: 'global', toolNames: ['notes'], skills: [], mcpServers: [] },
      ],
      miniAppGuides: [{ app: 'chess', file: '/apps/chess/guide.md' }],
      agents: [],
      promptSections: [],
    } as unknown as LoadedPlugins

    const out = buildPluginsPromptContext(loadedPlugins, ['chess', 'notes', 'mini_app_guide'])!
    expect(out).toContain('- chess — 1 direct tool; guide')
    expect(out).toContain('- notes — 1 direct tool\n')
    expect(out).toContain('mini_app_guide')
    // Without the tool on the wire, a guide is nothing the model can act on.
    const without = buildPluginsPromptContext(loadedPlugins, ['chess', 'notes'])!
    expect(without).not.toContain('guide')
  })

  test('returns no prompt context for plugins with no model-facing contribution', () => {
    const loadedPlugins = {
      loaded: [
        {
          name: 'commands-only',
          scope: 'global',
          description: 'Commands only',
          toolNames: [],
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
  test('every participant receives the live session topic in the system prompt, including a solo chat', async () => {
    const chat = sessionFixture({
      title: 'Release',
      goal: 'Ship the parser.',
      previousTopicSummary: 'Keep Bun; parser tests passed.',
      agents: ['lead', 'qa'].map((agentId) => ({
        agentId,
        handle: agentId,
        modelId: '',
        providerConnectionId: null,
        reasoningEffort: 'medium',
      })),
    })
    const agentProfile = resolveRunProfile({ sessionKind: 'chat' })
    const runtimeTools = createRuntimeToolRegistry({ policy: { agentProfile } })
    const build = (current: SessionRecord, speakerAgentId: string) =>
      buildRunSystemPrompt({
        userId: current.userId,
        session: current,
        speakerAgentId,
        policy: runPolicyFixture(current, speakerAgentId),
        providerId: 'test',
        agentProfile,
        runtimeTools,
        loadedPlugins: {
          loaded: [],
          agents: [],
          promptSections: [],
          outputStyles: [],
        } as unknown as LoadedPlugins,
        frozenContext: {},
        pinnedSkills: [],
        triggeredSkills: [],
        contextFiles: [],
        defaultCwd: '/tmp',
        scratchDir: '/tmp/localix-test',
        childRuntimeSessions: new Map(),
        now: () => '2026-10-08',
      })
    for (const agent of chat.agents) {
      const built = await build(chat, agent.agentId)
      expect(built.systemPrompt).toContain(chat.goal!)
      expect(built.systemPrompt).toContain(chat.previousTopicSummary!)
      expect(built.runtimeSections.map((s) => s.text).join('\n')).not.toContain(
        '# Session objective',
      )
    }
    const next = await build(
      { ...chat, agents: [chat.agents[0]!], goal: 'Deploy the parser.' },
      'lead',
    )
    expect(next.systemPrompt).toContain('Deploy the parser.')
    expect(next.systemPrompt).not.toContain(chat.goal!)
    expect(next.systemPrompt).toContain(chat.previousTopicSummary!)
  })

  test("a chat with no style of its own speaks in the person's default style; `default` opts out", async () => {
    const agentProfile = resolveRunProfile({ sessionKind: 'chat' })
    const runtimeTools = createRuntimeToolRegistry({ policy: { agentProfile } })
    const build = (outputStyle: string | null) => {
      const chat = { ...sessionFixture(), outputStyle }
      const speaker = chat.agents[0]!.agentId
      return buildRunSystemPrompt({
        userId: chat.userId,
        session: chat,
        speakerAgentId: speaker,
        policy: runPolicyFixture(chat, speaker),
        providerId: 'test',
        agentProfile,
        runtimeTools,
        loadedPlugins: {
          loaded: [],
          agents: [],
          promptSections: [],
          outputStyles: [],
        } as unknown as LoadedPlugins,
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
    expect((await build(null)).systemPrompt).toContain(
      'This conversation uses the "Explanatory" output style.',
    )
    expect((await build('default')).systemPrompt).not.toContain('# Output style')
  })

  test('keeps inline pinned instructions when the runtime has no skill tool', async () => {
    const runtimeTools = createRuntimeToolRegistry({
      policy: { agentProfile: SHAPE.subagent },
    })
    expect(runtimeTools.toolNames).not.toContain('skill')
    const loadedPlugins = {
      loaded: [],
      promptSections: [],
      agents: [],
    } as unknown as LoadedPlugins
    const agents = routedParticipants()
    const session = {
      id: 'sub',
      sessionKind: 'subagent',
      projectId: null,
      modelId: null,
      sourceToolCallId: null,
      parentSessionId: 'root',
      provenance: { kind: 'unknown-origin' },
      agents,
    } as unknown as SessionRecord
    const built = await buildRunSystemPrompt({
      userId: 'u',
      session,
      speakerAgentId: agents[0].agentId,
      policy: runPolicyFixture(session),
      providerId: 'test',
      agentProfile: SHAPE.subagent,
      runtimeTools,
      loadedPlugins,
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

    expect(built.systemPrompt).toContain('# Active skills (applied to this session)')
    expect(built.systemPrompt).toContain('Always inspect the final diff.')
    expect(built.systemPrompt).not.toContain('# Available skills')
  })
})
