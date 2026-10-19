/**
 * Group routing's second strategy, where no decision model is reachable: the embedding model
 * (EmbeddingGemma 2, the one Localix keeps here) by similarity. Available while its engine can
 * run; until then — downloading, failed — the chain passes on and the grammar decides.
 *
 * Only a person's untagged message is advised on: the participant whose description the latest
 * messages are nearest to takes it, when it leads the next one by a clear margin. Replies stay
 * with the grammar — similarity sees what a reply is about, not whether it reports or hands work
 * on, and measured no better than the address rules there.
 */
import { describeMember, floorTranscript, type FloorReading } from './floor-advice'
import type { FloorStrategy } from './floor-advisor'

/** How far the nearest option must lead the next one: below it the grammar decides. */
export const FLOOR_SIMILARITY_MARGIN = 0.08
/** The latest messages read, the event's own included. */
const SIMILARITY_WINDOW = 3

const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na * nb) || 1)
}

export function similarityFloorStrategy(deps: {
  /** Vectors from the embedding model while it can run; null otherwise. */
  embedder: () => ((text: string) => Promise<Float32Array>) | null
  model: string
}): FloorStrategy {
  return {
    async prepare() {
      const embed = deps.embedder()
      if (!embed) return null
      return {
        strategy: 'similarity',
        model: deps.model,
        async advise(question): Promise<FloorReading> {
          const unsure: FloorReading = { pick: null, reason: 'unsure', next: {} }
          if (question.authorAgentId || !question.leaderAgentId) return unsure
          const window = floorTranscript(question)
            .slice(-SIMILARITY_WINDOW)
            .map((message) => `${message.author}: ${message.text}`)
            .join('\n')
          const [asked, ...options] = await Promise.all([
            embed(window),
            ...question.members.map((member) =>
              embed(`${member.handle}: ${describeMember(member)}`),
            ),
          ])
          const next = Object.fromEntries(
            question.members.map((member, i) => [member.handle, cosine(asked!, options[i]!)]),
          )
          const [first, second] = Object.entries(next).sort((a, b) => b[1] - a[1])
          const clear = first && (!second || first[1] - second[1] >= FLOOR_SIMILARITY_MARGIN)
          return clear ? { pick: first[0], reason: 'similar', next } : { ...unsure, next }
        },
      }
    },
  }
}
