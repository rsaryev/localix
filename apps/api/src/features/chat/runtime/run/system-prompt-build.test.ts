import { activeDescendantSubagents } from './descendant-roster'
import { describe, expect, test } from 'bun:test'
import { resolveRunProfile } from '../../../agent-core/run-shape'

const SHAPE = { subagent: resolveRunProfile({ sessionKind: 'subagent' }) }
import { createRuntimeToolRegistry, onTheWire } from '../../../agent-core/tool-registry'
import type { SessionRecord } from '../../repository'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { RunSessionSnapshotRow } from './session-snapshot'
import { buildRunSystemPrompt, channelNameFromSourceKey } from './system-prompt-build'
import { buildPluginsPromptContext } from './plugins-prompt-context'
import { routedParticipants } from '../../../../testing/session-fixture'

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
    const built = await buildRunSystemPrompt({
      userId: 'u',
      session: {
        id: 'sub',
        sessionKind: 'subagent',
        projectId: null,
        modelId: null,
        sourceToolCallId: null,
        agents,
      } as unknown as SessionRecord,
      speakerAgentId: agents[0].agentId,
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
