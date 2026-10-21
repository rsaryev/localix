import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../db'
import { createChatFeaturePorts } from '../../bootstrap/chat-feature-ports'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { testWork } from '../../testing/work-fixture'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { StoredMessagePayload } from '../../db/payload'
import { createProviderConnectionsService } from '../provider-connections/service'
import { createChatRepository } from './repository'
import {
  createTestCatalogService as createCatalogService,
  createTestChatService as createChatService,
} from './test-harness'

const tempDir = join(import.meta.dir, `.tmp-history-search-${randomUUID()}`)

describe('chatService.searchHistory', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('finds messages by content (FTS5) and degrades on blank / no-match', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const chatService = createChatService({
      db,
      work: testWork(db),
      ports: createChatFeaturePorts(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_history_search'

    const session = await chatService.createSession(userId, { title: 'Infra chat' })
    const ts = new Date().toISOString()
    const payload: StoredMessagePayload = {
      id: 'msg_hs_1',
      role: 'user',
      from: USER_PARTICIPANT,
      content: "Let's set up docker for the build pipeline",
    }
    await repo.insertMessage({
      id: payload.id,
      sessionId: session.id,
      userId,
      payload,
      createdAt: ts,
      updatedAt: ts,
    })

    const hits = await chatService.searchHistory(userId, 'docker')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.sessionId).toBe(session.id)
    expect(hits[0]!.snippet.toLowerCase()).toContain('docker')
    const detailed = await chatService.searchHistoryDetailed(userId, 'docker')
    expect(detailed[0]).toMatchObject({
      messageId: payload.id,
      sessionId: session.id,
      sequence: 0,
    })

    const boundPayload: StoredMessagePayload = {
      id: 'msg_hs_2',
      role: 'user',
      from: USER_PARTICIPANT,
      content: 'Review the linked schema',
      bindings: [
        {
          kind: 'context',
          id: 'binding-hs-1',
          source: 'mention',
          target: {
            kind: 'resource',
            token: '@resource:localix://resource/fixture-db/x',
            label: 'schema',
          },
          resolution: {
            status: 'resolved',
            contributions: [
              {
                id: 'contribution-hs-1',
                providerId: 'test',
                providerVersion: '1',
                scope: 'session',
                kind: 'schema',
                content: 'fts_private_binding_marker',
                sensitivity: 'project',
              },
            ],
          },
        },
      ],
    }
    await repo.insertMessage({
      id: boundPayload.id,
      sessionId: session.id,
      userId,
      payload: boundPayload,
      createdAt: ts,
      updatedAt: ts,
    })
    expect(await chatService.searchHistory(userId, 'schema')).toHaveLength(1)
    expect(await chatService.searchHistory(userId, 'fts_private_binding_marker')).toEqual([])

    // A blank/whitespace query and a non-matching term both degrade to [] (no throw).
    expect(await chatService.searchHistory(userId, '   ')).toEqual([])
    expect(await chatService.searchHistoryDetailed(userId, '   ')).toEqual([])
    expect(await chatService.searchHistory(userId, 'zzzzneverappearszzzz')).toEqual([])

    // Scoped to the user — another user sees nothing.
    expect(await chatService.searchHistory('someone_else', 'docker')).toEqual([])

    for (const [id, content] of [
      ['assistant-first', 'First substantive reply'],
      ['assistant-latest', 'Latest substantive reply'],
      ['assistant-empty', ''],
    ] as const) {
      await repo.insertMessage({
        id,
        sessionId: session.id,
        userId,
        payload: { id, role: 'assistant', from: DEFAULT_AGENT_PARTICIPANT, content },
        createdAt: ts,
        updatedAt: ts,
      })
    }
    expect(
      (await repo.getLatestAutonomousAssistantContentMessage(userId, session.id))?.payload.content,
    ).toBe('Latest substantive reply')

    await destroyDatabase(db)
  })
})
