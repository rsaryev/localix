import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { zodToJsonSchema } from '@localixai/agent'

import { createDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import {
  createContextStoreRepository,
  MAX_CHUNKS_PER_SESSION,
} from '../../../context-store/repository'
import type { ChatRepository } from '../../../chat/repository'
import { createToolOutputTool } from './context-search'
import { createRateWindow } from './rate-window'

const tempDir = join(import.meta.dir, `.tmp-context-search-${randomUUID()}`)

describe('createRateWindow', () => {
  test('counts calls inside the window and forgets older ones', () => {
    const window = createRateWindow(1000)
    expect(window.record(0)).toBe(1)
    expect(window.record(500)).toBe(2)
    expect(window.record(999)).toBe(3)
    expect(window.record(1500)).toBe(2) // t=0 aged out; t=500 is exactly at the cutoff and drops
  })
})

describe('tool_output tool', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const setup = async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const store = createContextStoreRepository(db)
    const repo: Pick<ChatRepository, 'findActiveBranchToolCallMessage'> = {
      findActiveBranchToolCallMessage: async () => null,
    }
    return { db, store, repo }
  }

  test('finds indexed sections and labels them with their tool call', async () => {
    const { store, repo } = await setup()
    await store.indexToolOutput({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_1',
      toolName: 'bash',
      text: `error: connection refused at db.ts:12\n\n${'noise\n'.repeat(300)}`,
    })
    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const result = await tool.execute(
      'tc',
      { action: 'search', queries: ['connection refused'] },
      undefined,
      () => {},
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('connection refused at db.ts:12')
    expect(result.content).toContain('tool_call_id="call_1"')
  })

  test('discloses that the session cap shore off the head of a scoped output', async () => {
    const { db, store, repo } = await setup()
    await store.indexToolOutput({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_big',
      toolName: 'bash',
      text: `first section mentions kangaroo\n\n${'filler line\n'.repeat(600)}\nlater section mentions platypus`,
    })

    // Exactly the state the session cap leaves behind: it evicts oldest-rowid rows across the
    // whole session, and chunk 0 of an output holds its lowest rowid, so a prefix-shorn output
    // is one whose chunk 0 is gone while later chunks remain.
    await sql`
      DELETE FROM tool_output_chunks WHERE tool_call_id = 'call_big' AND chunk_index = 0
    `.execute(db)

    expect(await store.hasChunks('u1', 's1', 'call_big')).toBe(true)
    expect(await store.hasHeadChunk('u1', 's1', 'call_big')).toBe(false)

    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const hit = await tool.execute(
      'tc',
      { action: 'search', queries: ['platypus'], tool_call_id: 'call_big' },
      undefined,
      () => {},
    )
    expect(hit.content).toContain('partial index')
    expect(hit.details).toMatchObject({ partial: true })

    // The head is what was evicted, so a query answered only by it must not read as absence.
    const miss = await tool.execute(
      'tc',
      { action: 'search', queries: ['kangaroo'], tool_call_id: 'call_big' },
      undefined,
      () => {},
    )
    expect(miss.content).toContain('partial index')
  })

  test('discloses a saturated session index on the default unscoped search', async () => {
    const { db, store, repo } = await setup()
    await store.indexToolOutput({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_recent',
      toolName: 'bash',
      text: 'recent output mentions armadillo',
    })

    // Fill the session to its cap. An unscoped search cannot name which output lost
    // sections, so the honest signal is that the index is full and has been evicting.
    await sql`
      INSERT INTO tool_output_chunks
        (content, heading, tool_call_id, tool_name, chunk_index, session_id, user_id, created_at)
      WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ${MAX_CHUNKS_PER_SESSION})
      SELECT 'filler ' || i, NULL, 'call_filler_' || i, 'bash', 0, 's1', 'u1', '2026-01-01T00:00:00.000Z'
      FROM seq
    `.execute(db)
    expect(await store.chunkCount('u1', 's1')).toBeGreaterThanOrEqual(MAX_CHUNKS_PER_SESSION)

    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const result = await tool.execute(
      'tc',
      { action: 'search', queries: ['armadillo'] },
      undefined,
      () => {},
    )
    expect(result.content).toContain('filled its section cap')
    expect(result.details).toMatchObject({ partial: true })

    // A scoped search keeps its own, more precise answer rather than the session-level one.
    const scoped = await tool.execute(
      'tc',
      { action: 'search', queries: ['armadillo'], tool_call_id: 'call_recent' },
      undefined,
      () => {},
    )
    expect(scoped.content).not.toContain('filled its section cap')
  })

  test('says nothing about saturation while the session index has room', async () => {
    const { store, repo } = await setup()
    await store.indexToolOutput({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_small',
      toolName: 'bash',
      text: 'small output mentions armadillo',
    })
    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const result = await tool.execute(
      'tc',
      { action: 'search', queries: ['armadillo'] },
      undefined,
      () => {},
    )
    expect(result.content).not.toContain('partial index')
  })

  test('says nothing about partiality for a fully indexed output', async () => {
    const { store, repo } = await setup()
    await store.indexToolOutput({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_whole',
      toolName: 'bash',
      text: `error: connection refused\n\n${'noise\n'.repeat(300)}`,
    })
    expect(await store.hasHeadChunk('u1', 's1', 'call_whole')).toBe(true)

    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const result = await tool.execute(
      'tc',
      { action: 'search', queries: ['connection refused'], tool_call_id: 'call_whole' },
      undefined,
      () => {},
    )
    expect(result.content).not.toContain('partial index')
    expect(result.details).not.toMatchObject({ partial: true })
  })

  test('reports no matches without erroring, and rejects unsearchable queries', async () => {
    const { store, repo } = await setup()
    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const none = await tool.execute(
      'tc',
      { action: 'search', queries: ['walrus tuxedo'] },
      undefined,
      () => {},
    )
    expect(none.isError).toBeUndefined()
    expect(none.content).toContain('No indexed sections match')
    const junk = await tool.execute(
      'tc',
      { action: 'search', queries: ['***'] },
      undefined,
      () => {},
    )
    expect(junk.isError).toBe(true)
  })

  test('action="get" returns the full stored output through the same tool', async () => {
    const { store } = await setup()
    const repo = {
      findActiveBranchToolCallMessage: async () => ({
        payload: {
          items: [
            {
              id: 'call_full',
              toolCallId: 'call_full',
              name: 'bash',
              type: 'command' as const,
              status: 'completed' as const,
              resultText: 'FULL ORIGINAL OUTPUT',
            },
          ],
        },
      }),
    }
    const tool = createToolOutputTool(store, repo as never, 'u1', 's1')

    const result = await tool.execute('tc', { action: 'get', tool_call_id: 'call_full' })

    expect(result.isError).toBeUndefined()
    expect(result.content).toBe('FULL ORIGINAL OUTPUT')
  })

  test('validates the fields required by each action', async () => {
    const { store, repo } = await setup()
    const tool = createToolOutputTool(store, repo, 'u1', 's1')

    expect((await tool.execute('get', { action: 'get' })).content).toContain('tool_call_id')
    expect((await tool.execute('search', { action: 'search' })).content).toContain('queries')
  })

  test('can narrow its advertised actions for legacy per-tool deny settings', async () => {
    const { store, repo } = await setup()
    const getOnly = createToolOutputTool(store, repo, 'u1', 's1', ['get'])
    const schema = JSON.stringify(zodToJsonSchema(getOnly.inputSchema))

    expect(schema).toContain('"get"')
    expect(schema).not.toContain('"search"')
    expect(schema).not.toContain('queries')
  })

  test('lazy-indexes an un-indexed tool_call_id from the durable store', async () => {
    const { store } = await setup()
    const repo: Pick<ChatRepository, 'findActiveBranchToolCallMessage'> = {
      findActiveBranchToolCallMessage: async () =>
        ({
          payload: {
            items: [
              {
                type: 'tool_call',
                name: 'bash',
                toolCallId: 'call_lazy',
                status: 'completed',
                resultText: 'the elusive marmot appeared in the logs',
              },
            ],
          },
        }) as never,
    }
    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const result = await tool.execute(
      'tc',
      { action: 'search', queries: ['elusive marmot'], tool_call_id: 'call_lazy' },
      undefined,
      () => {},
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('elusive marmot')
    expect(await store.hasChunks('u1', 's1', 'call_lazy')).toBe(true)
  })

  // "Not indexed" is the skip policy's OUTCOME for a search/recovery result, not a gap the
  // self-heal should close. Closing it would file a search result in the index and let its
  // hits echo — and a stale compaction handle is enough to trigger exactly that.
  test('refuses to lazy-index a search result, and points at tool_output instead', async () => {
    const { store } = await setup()
    const repo: Pick<ChatRepository, 'findActiveBranchToolCallMessage'> = {
      findActiveBranchToolCallMessage: async () =>
        ({
          payload: {
            items: [
              {
                type: 'tool_call',
                name: 'tool_output',
                toolCallId: 'call_echo',
                status: 'completed',
                resultText: 'the elusive marmot appeared in the logs',
              },
            ],
          },
        }) as never,
    }
    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const result = await tool.execute(
      'tc',
      { action: 'search', queries: ['elusive marmot'], tool_call_id: 'call_echo' },
      undefined,
      () => {},
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('tool_output(action="get", tool_call_id="call_echo")')
    expect(await store.hasChunks('u1', 's1', 'call_echo')).toBe(false)
  })

  test('unknown tool_call_id errors cleanly', async () => {
    const { store, repo } = await setup()
    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    const result = await tool.execute(
      'tc',
      { action: 'search', queries: ['anything'], tool_call_id: 'ghost' },
      undefined,
      () => {},
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('ghost')
  })

  test('hard rate cap blocks with the batching instruction', async () => {
    const { store, repo } = await setup()
    const tool = createToolOutputTool(store, repo, 'u1', 's1')
    let verdict: Awaited<ReturnType<NonNullable<typeof tool.guard>>> | undefined
    for (let i = 0; i < 21; i++) {
      verdict = await tool.guard!({
        toolCallId: 'tc',
        input: { action: 'search', queries: ['x'] },
        signal: undefined,
      })
    }
    expect(verdict?.block).toBe(true)
    expect(verdict && 'result' in verdict ? verdict.result.content : '').toContain('Batch')
  })
})
