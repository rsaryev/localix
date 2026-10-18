import { client, unwrap } from './internal'
import type { SemanticStatus } from '@localixai/api/client'

/** Semantic search: model install, index state and its settings actions (`/rpc/semantic`). */
export const semanticApi = {
  async status(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.status.$get())
  },
  /** Turn on; the server downloads the pinned model first when it is missing. */
  async enable(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.enable.$post())
  },
  async disable(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.disable.$post())
  },
  /** Hold indexing; search keeps answering from what is already indexed. */
  async pause(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.pause.$post())
  },
  async resume(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.resume.$post())
  },
  /** Embed with another model (a catalog id of kind `embedding`); the index rebuilds with it. */
  async setModel(modelId: string): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.model.$post({ json: { modelId } }))
  },
  async rebuild(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.rebuild.$post())
  },
  async retry(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.retry.$post())
  },
  async removeModel(): Promise<SemanticStatus> {
    return unwrap(await client.rpc.semantic.model.$delete())
  },
  /** Search opened: start the engine so the first query does not wait for it. */
  async prewarm(): Promise<void> {
    await client.rpc.semantic.prewarm.$post()
  },
}

export type { SemanticStatus }
