import { client, unwrap } from './internal'
import type { SemanticStatus } from '@localixai/api/client'

/** Semantic search: model install, index state and its maintenance actions (`/rpc/semantic`). */
export const semanticApi = {
  async status(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.status.$get())
  },
  /** Hold indexing; search keeps answering from what is already indexed. */
  async pause(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.pause.$post())
  },
  async resume(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.resume.$post())
  },
  async rebuild(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.rebuild.$post())
  },
  async retry(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.retry.$post())
  },
  /** Search opened: start the engine so the first query does not wait for it. */
  async prewarm(): Promise<void> {
    await client.rpc.semantic.prewarm.$post()
  },
}

export type { SemanticStatus }
