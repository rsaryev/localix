import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { decodeArtifactText, encodeArtifactText } from './artifact-codec'
import { chunkToolOutput, MAX_CHUNKS } from './chunking'
import { MAX_CHUNKS_PER_SESSION } from '../agent-core/context-index-policy'

/**
 * Durable exact tool I/O plus its disposable FTS5 search projection. The exact
 * artifact is committed synchronously at the runtime tool boundary; chunks may be
 * rebuilt or evicted without invalidating `ToolOutput`.
 */

export interface ContextChunkHit {
  toolCallId: string
  toolName: string
  chunkIndex: number
  heading: string
  /** FTS5 snippet with [ ] match markers. */
  snippet: string
  content: string
}

export interface ToolOutputArtifact {
  toolCallId: string
  toolName: string
  text: string
  input: unknown
  isError: boolean
}

export type ContextStore = ReturnType<typeof createContextStoreRepository>

export function createContextStoreRepository(db: Kysely<AppDatabase>) {
  return {
    /**
     * Commit the exact sanitized tool result and its JSON input before the
     * runtime exposes any shortened model-facing copy. Idempotent for adapters
     * that replay a stable tool_call_id.
     */
    async putToolOutputArtifact(input: {
      userId: string
      sessionId: string
      toolCallId: string
      toolName: string
      text: string
      toolInput: unknown
      isError: boolean
    }): Promise<void> {
      const now = new Date().toISOString()
      const inputJson = JSON.stringify(input.toolInput) ?? 'null'
      const stored = encodeArtifactText(input.text)
      await db
        .insertInto('tool_output_artifacts')
        .values({
          user_id: input.userId,
          session_id: input.sessionId,
          tool_call_id: input.toolCallId,
          tool_name: input.toolName,
          content: stored.content,
          encoding: stored.encoding,
          content_z: stored.content_z,
          input_json: inputJson,
          is_error: input.isError ? 1 : 0,
          byte_length: stored.byteLength,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['user_id', 'session_id', 'tool_call_id']).doUpdateSet({
            tool_name: input.toolName,
            content: stored.content,
            encoding: stored.encoding,
            content_z: stored.content_z,
            input_json: inputJson,
            is_error: input.isError ? 1 : 0,
            byte_length: stored.byteLength,
            updated_at: now,
          }),
        )
        .execute()
    },

    async getToolOutputArtifact(
      userId: string,
      sessionId: string,
      toolCallId: string,
    ): Promise<ToolOutputArtifact | null> {
      const row = await db
        .selectFrom('tool_output_artifacts')
        .select([
          'tool_call_id',
          'tool_name',
          'content',
          'encoding',
          'content_z',
          'input_json',
          'is_error',
        ])
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('tool_call_id', '=', toolCallId)
        .executeTakeFirst()
      if (!row) return null
      let toolInput: unknown = null
      try {
        toolInput = JSON.parse(row.input_json)
      } catch {
        // A corrupt input copy must not hide the independently valid output.
      }
      return {
        toolCallId: row.tool_call_id,
        toolName: row.tool_name,
        text: decodeArtifactText(row),
        input: toolInput,
        isError: row.is_error === 1,
      }
    },

    /**
     * Chunk + index one tool output. Idempotent per tool_call_id (re-indexing a
     * call replaces its chunks — the label-replace rule that keeps a re-run from
     * accumulating stale copies). Returns the indexed chunk count, 0 when the
     * text has no indexable content.
     */
    /**
     * Index one tool output for chunk search.
     *
     * Reports `covered: 'full' | 'prefix'` rather than a bare count: chunking drops the
     * tail past its per-output cap, and a count alone cannot distinguish a fully indexed
     * output from the first 1.6 MB of a large one — which is exactly the difference a
     * caller advertising "this output is indexed" must not get wrong.
     */
    async indexToolOutput(input: {
      userId: string
      sessionId: string
      toolCallId: string
      toolName: string
      text: string
    }): Promise<{ sections: number; covered: 'full' | 'prefix' }> {
      const chunks = chunkToolOutput(input.text)
      const covered: 'full' | 'prefix' = chunks.length >= MAX_CHUNKS ? 'prefix' : 'full'
      if (chunks.length === 0) return { sections: 0, covered: 'full' }
      const createdAt = new Date().toISOString()
      // One transaction: the replace is atomic (a reader never sees the old rows gone and the
      // new ones half-written) and SQLite commits once instead of once per chunk.
      await db.transaction().execute(async (trx) => {
        await sql`
          DELETE FROM tool_output_chunks
          WHERE user_id = ${input.userId}
            AND session_id = ${input.sessionId}
            AND tool_call_id = ${input.toolCallId}
        `.execute(trx)
        for (let i = 0; i < chunks.length; i++) {
          await sql`
            INSERT INTO tool_output_chunks
              (content, heading, tool_call_id, tool_name, chunk_index, session_id, user_id, created_at)
            VALUES
              (${chunks[i].content}, ${chunks[i].heading}, ${input.toolCallId}, ${input.toolName},
               ${i}, ${input.sessionId}, ${input.userId}, ${createdAt})
          `.execute(trx)
        }
        // Session cap: evict the oldest rows so a long session's index stays bounded.
        // rowid order ≈ insertion order, which is exactly the eviction we want.
        await sql`
          DELETE FROM tool_output_chunks
          WHERE session_id = ${input.sessionId} AND user_id = ${input.userId}
            AND rowid NOT IN (
              SELECT rowid FROM tool_output_chunks
              WHERE session_id = ${input.sessionId} AND user_id = ${input.userId}
              ORDER BY rowid DESC LIMIT ${MAX_CHUNKS_PER_SESSION}
            )
        `.execute(trx)
      })
      return { sections: chunks.length, covered }
    },

    /**
     * Whether this tool call's indexed chunks still start at section 0.
     *
     * The session cap evicts the OLDEST rowids session-wide, and within one output chunk 0
     * carries the lowest rowid, so a surviving chunk 0 proves nothing of that output was
     * evicted — and its absence proves the head was. That distinction matters because
     * `hasChunks` answers "any chunk at all", which stays true for an output reduced to its
     * tail: a scoped search would then quietly cover a prefix-shorn output and report only
     * that nothing matched.
     */
    async hasHeadChunk(userId: string, sessionId: string, toolCallId: string): Promise<boolean> {
      const result = await sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM tool_output_chunks
        WHERE user_id = ${userId}
          AND session_id = ${sessionId}
          AND tool_call_id = ${toolCallId}
          AND chunk_index = 0
      `.execute(db)
      return Number(result.rows[0]?.n ?? 0) > 0
    },

    /**
     * How many chunks this session currently holds. At {@link MAX_CHUNKS_PER_SESSION} the
     * index is saturated, which means eviction has already discarded older sections — the
     * one fact an unscoped search needs before it reports an absence.
     */
    async chunkCount(userId: string, sessionId: string): Promise<number> {
      const result = await sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM tool_output_chunks
        WHERE user_id = ${userId} AND session_id = ${sessionId}
      `.execute(db)
      return Number(result.rows[0]?.n ?? 0)
    },

    /** Whether a tool call already has chunks — the lazy-index probe of ToolOutput. */
    async hasChunks(userId: string, sessionId: string, toolCallId: string): Promise<boolean> {
      const result = await sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM tool_output_chunks
        WHERE user_id = ${userId}
          AND session_id = ${sessionId}
          AND tool_call_id = ${toolCallId}
      `.execute(db)
      return Number(result.rows[0]?.n ?? 0) > 0
    },

    /**
     * BM25 search over this session's indexed outputs. `match` must be a
     * pre-sanitized FTS5 MATCH expression (`toFtsMatchQuery`). Heading weighted
     * over content (a hit in a section's first line is a stronger signal — the
     * title-weight idea from RRF-style retrieval, minus the second index).
     */
    async searchChunks(
      userId: string,
      sessionId: string,
      match: string,
      options?: { toolCallId?: string; limit?: number },
    ): Promise<ContextChunkHit[]> {
      const limit = options?.limit ?? 8
      const toolCallFilter = options?.toolCallId ?? null
      const result = await sql<{
        tool_call_id: string
        tool_name: string
        chunk_index: number
        heading: string
        snippet: string
        content: string
      }>`
        SELECT
          tool_call_id,
          tool_name,
          chunk_index,
          heading,
          snippet(tool_output_chunks, 0, '[', ']', '…', 40) AS snippet,
          content
        FROM tool_output_chunks
        WHERE tool_output_chunks MATCH ${match}
          AND user_id = ${userId}
          AND session_id = ${sessionId}
          AND (${toolCallFilter} IS NULL OR tool_call_id = ${toolCallFilter})
        ORDER BY bm25(tool_output_chunks, 1.0, 5.0)
        LIMIT ${limit}
      `.execute(db)
      return result.rows.map((row) => ({
        toolCallId: row.tool_call_id,
        toolName: row.tool_name,
        chunkIndex: Number(row.chunk_index),
        heading: row.heading,
        snippet: row.snippet,
        content: row.content,
      }))
    },
  }
}
