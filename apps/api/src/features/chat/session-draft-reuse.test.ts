/// <reference types="bun" />

import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { USER_PARTICIPANT } from '../../db'
import { createProviderConnectionsService } from '../provider-connections/service'
import { createChatRepository } from './repository'
import {
  createTestCatalogService as createCatalogService,
  createTestChatService as createChatService,
} from './test-runtime'
import { testWork } from '../../testing/work-fixture'

const tempDir = join(process.cwd(), 'tmp', 'session-draft-reuse-tests')

async function setup() {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  const chat = createChatService({
    db,
    work: testWork(db),
    catalogService: createCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db }),
  })
  return { db, chat, repo: createChatRepository(db) }
}

describe('landing on an empty draft', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('twelve windows landing at once converge on one chat', async () => {
    const { chat } = await setup()
    const userId = 'user_landing_race'
    const landed = await Promise.all(
      Array.from({ length: 12 }, () => chat.createSession(userId, { reuseEmptyDraft: true })),
    )
    expect(new Set(landed.map((session) => session.id)).size).toBe(1)
    expect((await chat.listSessions(userId)).sessions).toHaveLength(1)
    // The next launch lands on the same chat instead of leaving another one behind.
    const relaunch = await chat.createSession(userId, { reuseEmptyDraft: true })
    expect(relaunch.id).toBe(landed[0]!.id)
  })

  test('the New chat gesture still creates a new conversation', async () => {
    const { chat } = await setup()
    const userId = 'user_new_chat'
    const landed = await chat.createSession(userId, { reuseEmptyDraft: true })
    const fresh = await chat.createSession(userId, {})
    expect(fresh.id).not.toBe(landed.id)
    // A landing then picks the newest untouched one.
    expect((await chat.createSession(userId, { reuseEmptyDraft: true })).id).toBe(fresh.id)
  })

  test('never reopens a chat someone has used, renamed or archived', async () => {
    const { chat, repo } = await setup()
    const userId = 'user_used_drafts'
    const used = await chat.createSession(userId, { reuseEmptyDraft: true })
    const at = new Date().toISOString()
    await repo.insertMessage({
      id: 'msg_used',
      sessionId: used.id,
      userId,
      payload: { id: 'msg_used', role: 'user', from: USER_PARTICIPANT, content: 'hi' },
      createdAt: at,
      updatedAt: at,
    })
    const renamed = await chat.createSession(userId, { title: 'Deploy staging' })
    const archived = await chat.createSession(userId, {})
    await repo.updateSession(userId, archived.id, { archivedAt: at })
    const landed = await chat.createSession(userId, { reuseEmptyDraft: true })
    expect([used.id, renamed.id, archived.id]).not.toContain(landed.id)
  })

  test('reuses only a draft with the same participant', async () => {
    const { chat } = await setup()
    const userId = 'user_participant'
    const plain = await chat.createSession(userId, { reuseEmptyDraft: true })
    const again = await chat.createSession(userId, {
      reuseEmptyDraft: true,
      agents: [{ agentId: plain.agents![0]!.agentId }],
    })
    expect(again.id).toBe(plain.id)
  })
})
