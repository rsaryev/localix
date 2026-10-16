import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProjectsRepository } from '../projects/repository'
import type { PersistedMessage } from './contracts'
import { createChatRepository, type SessionRecord } from './repository'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../db'

const tempDir = join(process.cwd(), 'tmp', 'chat-repository-ancestry-tests')

function session(
  id: string,
  seq: number,
  parentSessionId: string | null,
  userId = 'user-a',
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  const timestamp = '2026-07-31T00:00:00.000Z'
  return sessionFixture({
    id,
    userId,
    seq,
    title: id,
    agents: routedParticipants({ modelId: '', reasoningEffort: 'low' }),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    parentSessionId,
    rootSessionId: parentSessionId ? null : id,
    sessionKind: parentSessionId ? 'subagent' : 'chat',
    provenance: parentSessionId
      ? {
          kind: 'task-delegation',
          parentSessionId,
          toolCallId: `delegate-${id}`,
        }
      : { kind: 'root' },
    ...overrides,
  })
}

function message(
  id: string,
  sessionId: string,
  content: string,
  options: {
    userId?: string
    role?: PersistedMessage['payload']['role']
    from?: PersistedMessage['payload']['from']
    isInternal?: boolean
    uiOnly?: boolean
    items?: PersistedMessage['payload']['items']
  } = {},
): PersistedMessage {
  const timestamp = '2026-07-31T00:00:00.000Z'
  return {
    id,
    sessionId,
    userId: options.userId ?? 'user-a',
    payload: {
      id,
      role: options.role ?? 'assistant',
      from:
        options.from ?? (options.role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT),
      content,
      isInternal: options.isInternal,
      uiOnly: options.uiOnly,
      items: options.items,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('repository session ancestry', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('returns only the owner-scoped parent chain in leaf-to-root order', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)

    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('parent', 2, 'root'))
    await repo.insertSession(session('leaf', 3, 'parent'))
    await repo.insertSession(session('unrelated', 4, null))
    await repo.insertSession(session('foreign', 5, null, 'user-b'))

    expect((await repo.listSessions('user-a')).map(({ id }) => id).sort()).toEqual([
      'leaf',
      'parent',
      'root',
      'unrelated',
    ])
    const ancestry = await repo.listSessionAncestry('user-a', 'leaf')

    expect(ancestry.map(({ id }) => id)).toEqual(['leaf', 'parent', 'root'])
    expect(ancestry.every(({ userId }) => userId === 'user-a')).toBe(true)
    await destroyDatabase(db)
  })

  /**
   * What the delegation budget counts: children created since the PERSON last wrote.
   *
   * A lifetime total walled off every long-lived chat; counting from the person's last message
   * bounds only the unattended stretch. Only the person resets it — a hidden internal user row
   * (a wake, a child's report) must not, or an agent could refill its own budget by being woken.
   */
  test('counts the children created since the last visible user message, and only those', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const at = (minute: number) => `2026-07-31T00:0${minute}:00.000Z`
    const child = (id: string, seq: number, minute: number) =>
      session(id, seq, 'root', 'user-a', { rootSessionId: 'root', createdAt: at(minute) })
    const row = (id: string, minute: number, isInternal?: boolean) => ({
      ...message(id, 'root', id, { role: 'user', isInternal }),
      createdAt: at(minute),
    })

    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(child('before', 2, 1))
    await repo.insertMessages([row('the person writes', 2)])
    await repo.insertSession(child('after-1', 3, 3))
    await repo.insertMessages([row('a hidden wake', 4, true)])
    await repo.insertSession(child('after-2', 4, 5))

    expect(await repo.countDelegationsSinceHuman('user-a', 'root')).toBe(2)
    await destroyDatabase(db)
  })

  test('a conversation the person never wrote in counts from its start', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('c1', 2, 'root', 'user-a', { rootSessionId: 'root' }))
    await repo.insertSession(session('c2', 3, 'root', 'user-a', { rootSessionId: 'root' }))
    expect(await repo.countDelegationsSinceHuman('user-a', 'root')).toBe(2)
    await destroyDatabase(db)
  })

  test('filters and limits recent chat projections inside SQLite', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const projects = createProjectsRepository(db)
    await projects.insertProject({
      id: 'project-a',
      seq: 1,
      userId: 'user-a',
      name: 'Project A',
      workingDir: '/project-a',
      settings: null,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      deletedAt: null,
    })
    await projects.insertProject({
      id: 'project-b',
      seq: 2,
      userId: 'user-a',
      name: 'Project B',
      workingDir: '/project-b',
      settings: null,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      deletedAt: null,
    })

    await repo.insertSession(
      session('project-old', 1, null, 'user-a', {
        projectId: 'project-a',
        updatedAt: '2026-07-29T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('project-new', 2, null, 'user-a', {
        projectId: 'project-a',
        updatedAt: '2026-07-31T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('other-project', 3, null, 'user-a', {
        projectId: 'project-b',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('system-newest', 4, null, 'user-a', {
        sessionKind: 'system',
        projectId: 'project-a',
        updatedAt: '2026-08-02T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('foreign', 5, null, 'user-b', {
        projectId: 'project-a',
        updatedAt: '2026-08-03T00:00:00.000Z',
      }),
    )

    const rows = await repo.listRecentChatSessions('user-a', {
      projectId: 'project-a',
      limit: 1,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'project-new',
      projectId: 'project-a',
      sessionKind: 'chat',
    })
    expect(await repo.getChatSessionProjection('user-a', 'project-new')).toEqual({
      id: 'project-new',
      title: 'project-new',
      projectId: 'project-a',
      // Identity travels with the route: a blank seat is resolved through the model chain by
      // `withResolvedRoutes`, which needs to know whose seat it is and where it lives.
      agentId: 'builtin:localix',
      runtimeStatus: 'idle',
      modelId: '',
      reasoningEffort: 'low',
      updatedAt: '2026-07-31T00:00:00.000Z',
      sessionKind: 'chat',
      providerConnectionId: null,
    })
    expect(await repo.getChatSessionProjection('user-a', 'system-newest')).toBeNull()
    expect(await repo.getChatSessionProjection('user-b', 'project-new')).toBeNull()
    await destroyDatabase(db)
  })

  test('projects only search metadata and applies owner and project scope in SQLite', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const projects = createProjectsRepository(db)
    await projects.insertProject({
      id: 'project-a',
      seq: 1,
      userId: 'user-a',
      name: 'Project A',
      workingDir: '/project-a',
      settings: null,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      deletedAt: null,
    })

    await repo.insertSession(session('global', 1, null))
    await repo.insertSession(session('project-root', 2, null, 'user-a', { projectId: 'project-a' }))
    await repo.insertSession(
      session('project-child', 3, 'project-root', 'user-a', { projectId: 'project-a' }),
    )
    await repo.insertSession(session('foreign', 4, null, 'user-b', { projectId: 'project-a' }))

    const projectRows = await repo.listSessionSearchRows('user-a', 'project-a')
    expect(projectRows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        id: 'project-child',
        title: 'project-child',
        projectId: 'project-a',
        parentSessionId: 'project-root',
        sessionKind: 'subagent',
      },
      {
        id: 'project-root',
        title: 'project-root',
        projectId: 'project-a',
        parentSessionId: null,
        sessionKind: 'chat',
      },
    ])
    // `null` means "do not narrow": there are no project-less sessions to select any more.
    expect((await repo.listSessionSearchRows('user-a', null)).map(({ id }) => id).sort()).toEqual([
      'global',
      'project-child',
      'project-root',
    ])
    await destroyDatabase(db)
  })

  test('projects only ordered root chat digest fields inside the project scope', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const projects = createProjectsRepository(db)
    for (const [id, seq] of [
      ['project-a', 1],
      ['project-b', 2],
    ] as const) {
      await projects.insertProject({
        id,
        seq,
        userId: 'user-a',
        name: id,
        workingDir: `/${id}`,
        settings: null,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
        deletedAt: null,
      })
    }

    await repo.insertSession(
      session('older-root', 1, null, 'user-a', {
        projectId: 'project-a',
        updatedAt: '2026-07-29T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('newer-root', 2, null, 'user-a', {
        projectId: 'project-a',
        runtimeStatus: 'running',
        updatedAt: '2026-07-31T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('child', 3, 'newer-root', 'user-a', {
        projectId: 'project-a',
        sessionKind: 'chat',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('system', 4, null, 'user-a', {
        projectId: 'project-a',
        sessionKind: 'system',
        updatedAt: '2026-08-02T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('other-project', 5, null, 'user-a', {
        projectId: 'project-b',
        updatedAt: '2026-08-03T00:00:00.000Z',
      }),
    )
    await repo.insertSession(
      session('foreign', 6, null, 'user-b', {
        projectId: 'project-a',
        updatedAt: '2026-08-04T00:00:00.000Z',
      }),
    )

    expect(await repo.listProjectRootChatSessions('user-a', 'project-a')).toEqual([
      {
        id: 'newer-root',
        title: 'newer-root',
        runtimeStatus: 'running',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
      {
        id: 'older-root',
        title: 'older-root',
        runtimeStatus: 'idle',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ])
    await destroyDatabase(db)
  })

  test('point-projects only owner model routing fields', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)

    await repo.insertSession(
      session('routing', 1, null, 'user-a', {
        agents: routedParticipants({ modelId: 'model-a', reasoningEffort: 'high' }),
      }),
    )
    expect(await repo.getSessionAgentRoute('user-a', 'routing')).toEqual({
      providerConnectionId: null,
      modelId: 'model-a',
      reasoningEffort: 'high',
      projectId: 'PRJ-fixture',
      agentId: 'builtin:localix',
    })
    expect(await repo.getSessionAgentRoute('user-b', 'routing')).toBeNull()
    await destroyDatabase(db)
  })

  test('projects only topology and live labels for each agent run', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)

    await repo.insertSession(
      session('root', 1, null, 'user-a', {
        title: 'Root',
        runtimeStatus: 'running',
        pinnedSkills: ['wide-field-must-not-leak'],
      }),
    )
    await repo.insertSession(session('foreign', 2, null, 'user-b'))

    expect(await repo.listRunSessionSnapshotRows('user-a')).toEqual([
      {
        id: 'root',
        userId: 'user-a',
        parentSessionId: null,
        sessionKind: 'chat',
        runtimeStatus: 'running',
        title: 'Root',
        // Carried so a room can tell a member its OWN delegated children from a colleague's:
        // the parent session id is shared by every member, the provenance is not.
        provenance: { kind: 'root' },
      },
    ])
    await destroyDatabase(db)
  })

  test('bounds the active-branch session digest while retaining exact metadata', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session('chat', 1, null))
    await repo.insertMessages([
      message('root-turn', 'chat', 'root', { role: 'user' }),
      message('older-turn', 'chat', 'older turn'),
      message('abandoned', 'chat', 'abandoned branch'),
    ])
    await repo.setSessionLeaf('chat', 'older-turn')
    await repo.insertMessages([
      message('current-1', 'chat', 'current 1', { role: 'user' }),
      message('current-ui', 'chat', 'hidden from tail', { uiOnly: true }),
      message('current-2', 'chat', 'current 2'),
      message('current-3', 'chat', 'current 3'),
      message('current-4', 'chat', 'current 4'),
      message('current-5', 'chat', 'current 5'),
      message('current-6', 'chat', 'current 6'),
      message('current-7', 'chat', 'current 7'),
    ])

    const digest = await repo.getSessionDigestMessages('user-a', 'chat', 6)
    expect(digest.messageCount).toBe(10)
    expect(digest.recentPayloads.map(({ id }) => id)).toEqual([
      'current-2',
      'current-3',
      'current-4',
      'current-5',
      'current-6',
      'current-7',
    ])
    await destroyDatabase(db)
  })

  test('bounds recent visible messages on the active branch with lookahead', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session('chat', 1, null))
    await repo.insertMessages([
      message('root-turn', 'chat', 'root', { role: 'user' }),
      message('branch-point', 'chat', 'branch point'),
      message('abandoned', 'chat', 'abandoned branch'),
    ])
    await repo.setSessionLeaf('chat', 'branch-point')
    await repo.insertMessages([
      message('current-1', 'chat', 'current one', { role: 'user' }),
      message('current-ui', 'chat', 'hidden', { uiOnly: true }),
      message('current-2', 'chat', 'current two'),
    ])

    const page = await repo.listRecentVisibleMessages('user-a', 'chat', 2)
    expect(page.hasMore).toBe(true)
    expect(page.messages.map(({ id }) => id)).toEqual(['current-2', 'current-1'])
    expect(page.messages.map(({ payload }) => payload.content)).toEqual([
      'current two',
      'current one',
    ])
    expect((await repo.listRecentVisibleMessages('user-a', 'chat', 4)).hasMore).toBe(false)
    // A pointer that cannot be walked is REPAIRED, not worked around. The old behaviour
    // returned every row in sequence order, which put `abandoned` — a branch the user
    // navigated away from — into the transcript as if they had seen it.
    await repo.setSessionLeaf('chat', 'missing')
    expect(
      (await repo.listRecentVisibleMessages('user-a', 'chat', 5)).messages.map(({ id }) => id),
    ).toEqual(['current-2', 'current-1', 'branch-point', 'root-turn'])
    // And the repair is durable: the pointer now names the tail, so the next read needs no
    // repair at all.
    expect(await repo.getSessionLeaf('chat')).toBe('current-2')
    expect(await repo.listRecentVisibleMessages('user-b', 'chat', 2)).toEqual({
      hasMore: false,
      messages: [],
    })
    await destroyDatabase(db)
  })

  test('point-reads the first matching tool call on the active message branch', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session('chat', 1, null))
    await repo.insertMessages([
      message('root', 'chat', 'root', { role: 'user' }),
      message('branch-point', 'chat', 'branch point'),
      message('abandoned-call', 'chat', 'abandoned', {
        items: [
          {
            id: 'call-1',
            type: 'tool_call',
            name: 'bash',
            activeVerb: 'Running',
            toolCallId: 'call-1',
            status: 'completed',
            resultText: 'abandoned output',
          },
        ],
      }),
    ])
    await repo.setSessionLeaf('chat', 'branch-point')
    await repo.insertMessages([
      message('current-call', 'chat', 'current', {
        items: [
          {
            id: 'call-1',
            type: 'tool_call',
            name: 'bash',
            activeVerb: 'Running',
            toolCallId: 'call-1',
            status: 'completed',
            resultText: 'current output',
          },
        ],
      }),
      message('later-copy', 'chat', 'later', {
        items: [
          {
            id: 'call-1',
            type: 'tool_call',
            name: 'bash',
            activeVerb: 'Running',
            toolCallId: 'call-1',
            status: 'running',
            resultText: 'later output',
          },
        ],
      }),
    ])

    expect((await repo.findActiveBranchToolCallMessage('user-a', 'chat', 'call-1'))?.id).toBe(
      'current-call',
    )
    expect(await repo.findActiveBranchToolCallMessage('user-a', 'chat', 'missing')).toBeNull()
    expect(
      (await repo.findActiveBranchToolCallMessage('user-a', 'chat', 'call-1', 'running'))?.id,
    ).toBe('later-copy')
    expect(
      (await repo.listActiveBranchToolCallMessagesByPrefix('user-a', 'chat', 'call-1')).map(
        ({ id }) => id,
      ),
    ).toEqual(['current-call', 'later-copy'])
    await destroyDatabase(db)
  })
})
