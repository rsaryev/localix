import { describe, expect, test } from 'bun:test'
import type { SearchQuery } from '../agent-core/search/provider'
import { createAgentsSearchProvider } from '../agents/search-provider'
import {
  createMessagesSearchProvider,
  createSessionsSearchProvider,
  shareOverlappingSessionSearchReads,
} from '../chat/search-provider'
import { createModelsSearchProvider } from '../catalog/search-provider'
import { createMcpSearchProvider } from '../mcp/search-provider'
import { createPluginsSearchProvider } from '../plugins/search-provider'
import { createSkillsSearchProvider } from '../skills-curator/search-provider'
import { searchHitsOf } from '@localixai/plugin-sdk/backend'

const scopedQuery: SearchQuery = { text: 'target', projectId: 'project/a' }

describe('capability search navigation', () => {
  test('uses exact, encoded, project-scoped settings URIs for every registry domain', async () => {
    const seen: Array<string | null | undefined> = []
    const providers = [
      createSkillsSearchProvider({
        listSkills: async (_userId, projectId) => {
          seen.push(projectId)
          return [{ name: 'target/skill', description: 'Target skill' }]
        },
      }),
      createPluginsSearchProvider({
        listPlugins: async (_userId, projectId) => {
          seen.push(projectId)
          return [{ name: 'target/plugin', displayName: 'Target plugin', description: 'Plugin' }]
        },
      }),
      createMcpSearchProvider({
        listServers: async (_userId, projectId) => {
          seen.push(projectId)
          return [{ name: 'target/mcp', description: 'MCP server' }]
        },
      }),
      createAgentsSearchProvider({
        listAgents: async (_userId, projectId) => {
          seen.push(projectId)
          return [{ name: 'target/agent', label: 'Target agent', description: 'Delegate' }]
        },
      }),
    ]

    const hits = await Promise.all(
      providers.map(async (provider) => searchHitsOf(await provider.search('user', scopedQuery))),
    )

    expect(seen).toEqual(Array.from({ length: providers.length }, () => 'project/a'))
    expect(hits.map((group) => group[0]?.id)).toEqual([
      'localix://ui/settings/skills/skill-target%2Fskill?scope=project%2Fa',
      'localix://ui/settings/plugins/plugin-target%2Fplugin?scope=project%2Fa',
      'localix://ui/settings/mcp/mcp-target%2Fmcp?scope=project%2Fa',
      'localix://ui/settings/agents/agent-target%2Fagent?scope=project%2Fa',
    ])
  })

  test('represents the no-project scope explicitly instead of falling back globally', async () => {
    let received: string | null | undefined = 'not-called'
    const provider = createPluginsSearchProvider({
      listPlugins: async (_userId, projectId) => {
        received = projectId
        return [{ name: 'target', description: 'Target' }]
      },
    })
    const [hit] = searchHitsOf(await provider.search('user', { text: 'target', projectId: null }))
    expect(received).toBeNull()
    expect(hit?.id).toBe('localix://ui/settings/plugins/plugin-target?scope=')
  })

  test('does not turn a sparse match across a long plugin description into a result', async () => {
    const provider = createPluginsSearchProvider({
      listPlugins: async () => [
        {
          name: 'sample-provider',
          description:
            'Database workspace with connection browsers, schema explorers, query consoles and agent tools.',
        },
      ],
    })
    expect(await provider.search('user', { text: 'sample query', projectId: null })).toEqual([])
  })

  test('routes model matches to the real Providers tab', async () => {
    const provider = createModelsSearchProvider({
      listModels: async () => [{ id: 'target/model', name: 'Target model' }],
    })
    const [hit] = searchHitsOf(await provider.search('user', scopedQuery))
    expect(hit?.id).toBe('localix://resource/model/target%2Fmodel')
    expect(hit?.uri).toBe('localix://ui/settings/providers?scope=project%2Fa')
  })
})

describe('chat search navigation and scope', () => {
  const sessions = [
    {
      id: 'session-a',
      title: 'Target project chat',
      projectId: 'project/a',
      parentSessionId: null,
      sessionKind: 'chat',
    },
    {
      id: 'session-global',
      title: 'Target no-project chat',
      projectId: null,
      parentSessionId: null,
      sessionKind: 'chat',
    },
  ]

  test('filters chats to the exact project and no-project scopes', async () => {
    const provider = createSessionsSearchProvider({
      listSessions: async () => sessions,
      searchMessages: async () => [],
    })
    expect(
      searchHitsOf(await provider.search('user', { text: 'target', projectId: 'project/a' })).map(
        (hit) => hit.id,
      ),
    ).toEqual(['localix://resource/chat/session/session-a'])
    expect(
      searchHitsOf(await provider.search('user', { text: 'target', projectId: null })).map(
        (hit) => hit.id,
      ),
    ).toEqual(['localix://resource/chat/session/session-global'])
  })

  test('addresses the exact FTS message and excludes another project', async () => {
    const provider = createMessagesSearchProvider({
      listSessions: async () => sessions,
      searchMessages: async () => [
        {
          messageId: 'message/42',
          sessionId: 'session-a',
          role: 'assistant',
          snippet: '[target] result',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          messageId: 'message-global',
          sessionId: 'session-global',
          role: 'user',
          snippet: '[target] elsewhere',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    })
    const hits = searchHitsOf(await provider.search('user', scopedQuery))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe('localix://resource/chat/message/session-a/message%2F42')
    expect(hits[0]?.subtitle).toContain('target result')
  })

  test('shares only overlapping scoped session roster reads', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const listSessions = shareOverlappingSessionSearchReads(async () => {
      calls += 1
      await gate
      return sessions
    })

    const first = listSessions('user', 'project/a')
    const second = listSessions('user', 'project/a')
    expect(calls).toBe(1)
    expect(first).toBe(second)

    release()
    await Promise.all([first, second])
    await listSessions('user', 'project/a')
    expect(calls).toBe(2)
  })

  test('does not conflate all-project and global-only roster scopes', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const listSessions = shareOverlappingSessionSearchReads(async () => {
      calls += 1
      await gate
      return sessions
    })

    const allProjects = listSessions('user')
    const globalOnly = listSessions('user', null)
    expect(calls).toBe(2)
    expect(allProjects).not.toBe(globalOnly)

    release()
    await Promise.all([allProjects, globalOnly])
  })
})
