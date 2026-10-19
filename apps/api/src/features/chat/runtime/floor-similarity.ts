/**
 * Group routing's second strategy, where no decision model is reachable: the embedding model
 * (EmbeddingGemma 2, the one Localix keeps here) by similarity, through the vectors port
 * (`embeddings/semantic-vectors.ts`). Available while its engine can run; until then —
 * downloading, failed — the chain passes on and the grammar decides.
 *
 * Only a person's untagged message is advised on: the participant whose description the latest
 * messages are nearest to takes it, when it leads the next one by a clear margin. Replies stay
 * with the grammar — similarity sees what a reply is about, not whether it reports or hands work
 * on, and measured no better than the address rules there.
 */
import type { SemanticVectors } from '@localixai/plugin-sdk/backend'
import { describeMember, floorTranscript, type FloorReading } from './floor-advice'
import type { FloorStrategy } from './floor-advisor'

/** How far the nearest option must lead the next one: below it the grammar decides. */
export const FLOOR_SIMILARITY_MARGIN = 0.08
/** The latest messages read, the event's own included. */
const SIMILARITY_WINDOW = 3

export function similarityFloorStrategy(
  vectors: Pick<SemanticVectors, 'ready' | 'rank'>,
): FloorStrategy {
  return {
    async prepare() {
      const ready = vectors.ready()
      if (!ready) return null
      return {
        strategy: 'similarity',
        model: ready.model,
        async advise(question): Promise<FloorReading> {
          const unsure: FloorReading = { pick: null, reason: 'unsure', next: {} }
          if (question.authorAgentId || !question.leaderAgentId) return unsure
          const window = floorTranscript(question)
            .slice(-SIMILARITY_WINDOW)
            .map((message) => `${message.author}: ${message.text}`)
            .join('\n')
          const ranking = await vectors.rank(
            window,
            question.members.map((member) => ({
              key: member.handle,
              text: `${member.handle}: ${describeMember(member)}`,
            })),
            { task: 'classification' },
          )
          if (!ranking) return unsure
          const next = Object.fromEntries(ranking.ranked.map((entry) => [entry.key, entry.cosine]))
          const [first, second] = ranking.ranked
          const clear =
            first && (!second || first.cosine - second.cosine >= FLOOR_SIMILARITY_MARGIN)
          return clear ? { pick: first.key, reason: 'similar', next } : { ...unsure, next }
        },
      }
    },
  }
}
