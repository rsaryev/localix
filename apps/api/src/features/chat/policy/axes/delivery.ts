/**
 * DELIVERY — where the run's reply goes: the Localix transcript, or a messaging channel that
 * relays it back to the person automatically.
 *
 * A channel session is keyed `channel:<plugin>:<channel>:<conversationId>` when it is created
 * (`resolveExternalSession`); that key is the only thing that says the reply leaves the app.
 */
import { defineAxis } from '../axis'

export interface DeliveryFacts {
  sourceToolCallId?: string | null
}

export interface DeliveryDecision {
  /** The channel name the reply is relayed through; absent for the transcript. */
  channel?: string
}

/** Extract the channel name from `channel:<plugin>:<channel>:<conversation>` provenance. */
export function channelNameFromSourceKey(sourceToolCallId: string | null | undefined) {
  if (!sourceToolCallId?.startsWith('channel:')) return undefined
  const [, pluginName, channelName] = sourceToolCallId.split(':', 4)
  return pluginName && channelName ? channelName : undefined
}

export const deliveryAxis = defineAxis<DeliveryFacts, DeliveryDecision>('delivery', [
  {
    id: 'channel',
    applies: (facts) => channelNameFromSourceKey(facts.sourceToolCallId) !== undefined,
    decide: (facts) => ({ channel: channelNameFromSourceKey(facts.sourceToolCallId)! }),
  },
  { id: 'transcript', applies: () => true, decide: () => ({}) },
])
