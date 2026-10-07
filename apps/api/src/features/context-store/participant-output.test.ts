import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { ParticipantRef } from '../../db/participant'
import { sessionFixture } from '../../testing/session-fixture'
import { createChatRepository } from '../chat/repository'
import { createToolOutputTool } from '../agent-core/tools/context-search/context-search'
import { createContextStoreRepository } from './repository'
import { buildExternalizeAfterToolCall } from './externalize'

const temp = mkdtempSync(join(tmpdir(), 'localix-participant-output-'))
const db = createDatabase({ filename: join(temp, 'test.sqlite') })
const repo = createChatRepository(db)
const store = createContextStoreRepository(db)
const session = sessionFixture({ id: 'room', userId: 'user-a' })
const lead = 'agent:lead'
const qa = 'agent:qa'
const outputTool = (participant: string) =>
  createToolOutputTool(store, repo, session.userId, session.id, ['get', 'search'], participant)

beforeAll(async () => {
  await migrateToLatest(db)
  await repo.insertSession(session)
})
afterAll(async () => {
  await destroyDatabase(db)
  rmSync(temp, { recursive: true, force: true })
})

async function persist(call: string, participant: string, text: string) {
  await buildExternalizeAfterToolCall(store, {
    userId: session.userId,
    sessionId: session.id,
    participant,
    threshold: 1,
    sanitizeInput: (input) => input,
  })(
    { toolCallId: call, toolName: 'bash', input: {}, result: { content: text } },
    new AbortController().signal,
  )
}

async function legacy(call: string, participant: ParticipantRef) {
  await repo.insertMessages([
    {
      id: `message-${call}`,
      userId: session.userId,
      sessionId: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      payload: {
        id: `message-${call}`,
        role: 'assistant',
        from: participant,
        content: '',
        items: [
          {
            id: call,
            toolCallId: call,
            type: 'tool_call',
            name: 'bash',
            activeVerb: 'Running',
            status: 'completed',
            resultText: `legacy ${call} evidence`,
          },
        ],
      },
    },
  ])
}

describe('participant tool output isolation', () => {
  test('exact recovery before message persistence serves only the executing participant', async () => {
    await persist('live-lead', lead, 'lead-only evidence')
    expect(
      (await outputTool(lead).execute('get', { action: 'get', tool_call_id: 'live-lead' })).content,
    ).toBe('lead-only evidence')
    const denied = await outputTool(qa).execute('get', { action: 'get', tool_call_id: 'live-lead' })
    expect(denied.isError).toBe(true)
    expect(denied.content).not.toContain('lead-only evidence')
  })

  test('unscoped and scoped search filter ownership before applying the hit limit', async () => {
    for (let i = 0; i < 8; i++) await persist(`foreign-${i}`, lead, `kangaroo private-${i}`)
    await persist('own-qa', qa, 'kangaroo public-qa')
    const tool = outputTool(qa)
    const result = await tool.execute('search', { action: 'search', queries: ['kangaroo'] })
    expect(result.content).toContain('public-qa')
    expect(result.content).not.toContain('private-')
    const scoped = await tool.execute('search', {
      action: 'search',
      queries: ['kangaroo'],
      tool_call_id: 'foreign-0',
    })
    expect(scoped.content).not.toContain('private-')
  })

  test('legacy lazy recovery requires its own attributed message', async () => {
    await legacy('old-lead', lead)
    await legacy('old-qa', qa)
    const tool = outputTool(qa)
    expect((await tool.execute('get', { action: 'get', tool_call_id: 'old-lead' })).isError).toBe(
      true,
    )
    expect((await tool.execute('get', { action: 'get', tool_call_id: 'old-qa' })).content).toBe(
      'legacy old-qa evidence',
    )
    const lazy = await tool.execute('search', {
      action: 'search',
      queries: ['evidence'],
      tool_call_id: 'old-qa',
    })
    expect(lazy.content).toContain('legacy old-qa evidence')
    expect(
      (
        await outputTool(lead).execute('search', {
          action: 'search',
          queries: ['evidence'],
          tool_call_id: 'old-qa',
        })
      ).content,
    ).not.toContain('legacy old-qa evidence')
  })

  test('unattributed artifacts and indexed outputs fail closed', async () => {
    await store.putToolOutputArtifact({
      userId: session.userId,
      sessionId: session.id,
      toolCallId: 'unknown',
      toolName: 'bash',
      text: 'unknown aardvark secret',
      toolInput: {},
      isError: false,
    })
    await store.indexToolOutput({
      userId: session.userId,
      sessionId: session.id,
      toolCallId: 'unknown',
      toolName: 'bash',
      text: 'unknown aardvark secret',
    })
    const tool = outputTool(qa)
    expect((await tool.execute('get', { action: 'get', tool_call_id: 'unknown' })).isError).toBe(
      true,
    )
    expect(
      (await tool.execute('search', { action: 'search', queries: ['aardvark'] })).content,
    ).not.toContain('unknown aardvark secret')
  })
})
