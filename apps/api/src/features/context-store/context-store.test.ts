import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createSecretExposureShield } from '../secrets/exposure-shield'
import { chunkToolOutput, MAX_CHUNK_BYTES } from './chunking'
import { buildExternalizeAfterToolCall } from './externalize'
import { createContextStoreRepository } from './repository'
import { MAX_CHUNKS } from './chunking'

const tempDir = join(import.meta.dir, `.tmp-context-store-${randomUUID()}`)

describe('chunkToolOutput', () => {
  test('empty and whitespace-only text produce no chunks', () => {
    expect(chunkToolOutput('')).toEqual([])
    expect(chunkToolOutput('\n\n  \n')).toEqual([])
  })

  test('small blank-line sections are merged, not shattered', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i} of section\n`).join('\n')
    const chunks = chunkToolOutput(text)
    expect(chunks.length).toBe(1)
    expect(chunks[0].heading).toBe('line 0 of section')
  })

  test('markdown headings become section boundaries with the heading as title', () => {
    const text = `# Alpha\nbody a\n\n# Beta\nbody b`
    const chunks = chunkToolOutput(text)
    expect(chunks.length).toBe(1) // both tiny sections merge under the cap
    const big = `# Alpha\n${'a'.repeat(3000)}\n# Beta\n${'b'.repeat(3000)}`
    const split = chunkToolOutput(big)
    expect(split.length).toBe(2)
    expect(split[0].heading).toBe('# Alpha')
    expect(split[1].heading).toBe('# Beta')
  })

  test('every chunk respects the byte cap and oversized sections keep overlap', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `log line ${i} ${'x'.repeat(40)}`)
    const chunks = chunkToolOutput(lines.join('\n'))
    expect(chunks.length).toBeGreaterThan(1)
    const utf8 = new TextEncoder()
    for (const c of chunks)
      expect(utf8.encode(c.content).length).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
    // Overlap: the second chunk starts with lines the first chunk ends with.
    const firstTail = chunks[0].content.split('\n').at(-1)!
    expect(chunks[1].content).toContain(firstTail)
  })

  test('a single line over the cap is hard-cut instead of dropped', () => {
    const chunks = chunkToolOutput('short\n' + 'y'.repeat(MAX_CHUNK_BYTES * 2))
    expect(chunks.some((c) => c.content.startsWith('yyy'))).toBe(true)
    const utf8 = new TextEncoder()
    for (const c of chunks)
      expect(utf8.encode(c.content).length).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
  })
})

describe('contextStoreRepository', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const setup = async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    return createContextStoreRepository(db)
  }

  test('reports prefix coverage when an output exceeds the per-output chunk cap', async () => {
    const store = await setup()
    // Chunking caps one output at MAX_CHUNKS and DROPS the rest; ~3 MB clears that cap.
    const text = Array.from(
      { length: Math.round((3 * 1024 * 1024) / 30) },
      (_, i) => `line ${i} payload text`,
    ).join('\n')

    const indexed = await store.indexToolOutput({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_huge',
      toolName: 'bash',
      text,
    })

    expect(indexed.sections).toBe(MAX_CHUNKS)
    expect(indexed.covered).toBe('prefix')
    // The head survives — it is the tail that was never indexed, which is precisely why the
    // count alone cannot be trusted as a coverage claim.
    expect(await store.hasHeadChunk('u1', 's1', 'call_huge')).toBe(true)
  })

  test('index → search finds the matching section only, scoped by session', async () => {
    const store = await setup()
    const text = `FAIL src/auth.test.ts\n  expected token to be valid\n\n${'filler line\n'.repeat(400)}\nPASS src/db.test.ts`
    const sections = await store.indexToolOutput({
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_1',
      toolName: 'bash',
      text,
    })
    expect(sections.sections).toBeGreaterThan(1)
    // A modest output is indexed whole; only a >1.6 MB one gets a prefix.
    expect(sections.covered).toBe('full')
    expect(await store.hasChunks('u1', 's1', 'call_1')).toBe(true)

    const hits = await store.searchChunks('u1', 's1', '"token" "valid"')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].content).toContain('expected token to be valid')
    expect(hits[0].toolCallId).toBe('call_1')

    // Other session / other user see nothing.
    expect(await store.searchChunks('u1', 'other', '"token"')).toEqual([])
    expect(await store.searchChunks('u2', 's1', '"token"')).toEqual([])
  })

  test('re-indexing a tool call replaces its chunks (no stale accumulation)', async () => {
    const store = await setup()
    const base = { userId: 'u1', sessionId: 's1', toolCallId: 'call_x', toolName: 'bash' }
    await store.indexToolOutput({ ...base, text: 'first version speaks about walruses' })
    await store.indexToolOutput({ ...base, text: 'second version speaks about penguins' })
    expect(await store.searchChunks('u1', 's1', '"walruses"')).toEqual([])
    const hits = await store.searchChunks('u1', 's1', '"penguins"')
    expect(hits.length).toBe(1)
  })

  test('toolCallId filter scopes the search', async () => {
    const store = await setup()
    const base = { userId: 'u1', sessionId: 's1', toolName: 'bash' }
    await store.indexToolOutput({ ...base, toolCallId: 'a', text: 'zebra appears here' })
    await store.indexToolOutput({ ...base, toolCallId: 'b', text: 'zebra appears there too' })
    const all = await store.searchChunks('u1', 's1', '"zebra"')
    expect(all.length).toBe(2)
    const scoped = await store.searchChunks('u1', 's1', '"zebra"', { toolCallId: 'b' })
    expect(scoped.length).toBe(1)
    expect(scoped[0].toolCallId).toBe('b')
  })

  test('same toolCallId in two sessions never deletes or satisfies the other session', async () => {
    const store = await setup()
    const shared = { userId: 'u1', toolCallId: 'shared-call', toolName: 'bash' }
    await store.indexToolOutput({
      ...shared,
      sessionId: 's1',
      text: 'alpha-session-only marker',
    })
    await store.indexToolOutput({
      ...shared,
      sessionId: 's2',
      text: 'beta-session-only marker',
    })

    expect(await store.hasChunks('u1', 's1', 'shared-call')).toBe(true)
    expect(await store.hasChunks('u1', 's2', 'shared-call')).toBe(true)
    expect(await store.hasChunks('u1', 'missing', 'shared-call')).toBe(false)
    expect(await store.searchChunks('u1', 's1', '"alpha"')).toHaveLength(1)
    expect(await store.searchChunks('u1', 's1', '"beta"')).toEqual([])
    expect(await store.searchChunks('u1', 's2', '"beta"')).toHaveLength(1)
    expect(await store.searchChunks('u1', 's2', '"alpha"')).toEqual([])
  })

  test('the durable input_json contains shielded heavy args and no remembered secret', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    await sql`
      INSERT INTO agent_sessions (id, user_id, project_id, title)
      VALUES ('s1', 'u1', 'PRJ-test', 'artifact shield test')
    `.execute(db)
    const store = createContextStoreRepository(db)
    const shield = createSecretExposureShield()
    const secret = 'sk-durable-input-secret-abcdef123456'
    const safeContent = 'export const safeValue = 42\n'
    shield.remember('u1', secret)
    const hook = buildExternalizeAfterToolCall(store, {
      userId: 'u1',
      sessionId: 's1',
      sanitizeInput: (value) => shield.redactValue('u1', value),
    })

    await hook(
      {
        toolCallId: 'write_1',
        toolName: 'write',
        input: {
          path: 'src/safe.ts',
          content: `${safeContent}// token=${secret}\n`,
        },
        result: { content: 'Wrote src/safe.ts' },
      },
      new AbortController().signal,
    )

    const row = await db
      .selectFrom('tool_output_artifacts')
      .select('input_json')
      .where('user_id', '=', 'u1')
      .where('session_id', '=', 's1')
      .where('tool_call_id', '=', 'write_1')
      .executeTakeFirstOrThrow()
    expect(row.input_json).not.toContain(secret)
    expect(row.input_json).toContain('[vault-secret]')
    expect(row.input_json).toContain(safeContent.trim())
  })

  test('exact artifacts are scoped, idempotent, and cascade with the session', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    await sql`
      INSERT INTO agent_sessions (id, user_id, project_id, title)
      VALUES ('s1', 'u1', 'PRJ-test', 'artifact test')
    `.execute(db)
    const store = createContextStoreRepository(db)
    const base = {
      userId: 'u1',
      sessionId: 's1',
      toolCallId: 'call_exact',
      toolName: 'write',
      toolInput: { path: 'a.ts', content: 'original input' },
      isError: false,
    }

    await store.putToolOutputArtifact({ ...base, text: 'first output' })
    await store.putToolOutputArtifact({ ...base, text: 'replacement output' })
    expect(await store.getToolOutputArtifact('u1', 's1', 'call_exact')).toEqual({
      toolCallId: 'call_exact',
      toolName: 'write',
      text: 'replacement output',
      input: { path: 'a.ts', content: 'original input' },
      isError: false,
    })
    expect(await store.getToolOutputArtifact('other', 's1', 'call_exact')).toBeNull()

    await sql`DELETE FROM agent_sessions WHERE id = 's1'`.execute(db)
    expect(await store.getToolOutputArtifact('u1', 's1', 'call_exact')).toBeNull()
  })
})
