import type {
  ListingRef,
  RecommendDismissals,
  RecommendEvent,
  RecommendRead,
  RecommendRequest,
} from '@localixai/store'
import { assertOk, cleanQuery, client, unwrap } from './internal'

/** The Store's recommendations (`docs/internals/store.md`, "Recommendations"), part of `storeApi`. */
export const storeRecommendApi = {
  /** The working set moved: the open tabs and chips, the project and the chat. Answered later. */
  async reportWorkingSet(request: RecommendRequest): Promise<void> {
    await assertOk(await client.rpc.store.recommendations['working-set'].$post({ json: request }))
  },

  /** The person is not interested in a package (or takes it back): never recommended again. */
  async dismissRecommendation(ref: ListingRef, dismissed: boolean): Promise<void> {
    await assertOk(
      await client.rpc.store.recommendations.dismissals.$put({ json: { ref, dismissed } }),
    )
  },

  /** Recommendations a surface showed, or the one the person opened from it. */
  async recordRecommendationEvents(events: readonly RecommendEvent[]): Promise<void> {
    await assertOk(
      await client.rpc.store.recommendations.events.$post({ json: { events: [...events] } }),
    )
  },

  /** What is kept out of the recommendations, newest first, and why. */
  async dismissedRecommendations(): Promise<RecommendDismissals> {
    return unwrap(await client.rpc.store.recommendations.dismissals.$get())
  },

  /** What the background worked out for a project and chat (`store-recommendations` pokes it). */
  async recommendations(where: {
    projectId?: string | null
    sessionId?: string | null
  }): Promise<RecommendRead> {
    return unwrap(
      await client.rpc.store.recommendations.$get({
        query: cleanQuery({
          ...(where.projectId ? { projectId: where.projectId } : {}),
          ...(where.sessionId ? { sessionId: where.sessionId } : {}),
        }),
      }),
    )
  },
}
