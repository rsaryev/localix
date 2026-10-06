import { isTextItem } from '@localixai/agent/agents/items'
import type { PluginTranscriptMessage } from '@localixai/plugin-sdk/ui/runtime'
import type { TranscriptTurn } from './types'

export type ExternalTranscriptMessage = PluginTranscriptMessage

/**
 * A foreign session's turns, in our own message model.
 *
 * This is the whole adapter: everything downstream — virtualization, scroll restoration, the find
 * bar, tool cards, bubbles — is the chat's, unchanged. Getting a foreign transcript on screen is
 * therefore a question of shaping it, not of drawing it.
 *
 * A user turn carries `content` and no items: our user bubble reads `content`, and a user message
 * has no tool activity to group. An assistant turn carries `items` and lets the card lay them out
 * exactly as it lays out ours — prose as bubbles, consecutive tool runs folded into one chain.
 */
export function toMessages(
  turns: readonly TranscriptTurn[],
  sessionKey: string,
): ExternalTranscriptMessage[] {
  const messages: ExternalTranscriptMessage[] = []
  for (const [index, turn] of turns.entries()) {
    // Ids are positional and namespaced by the session key: they key React rows and the
    // message-focus bus, and two foreign transcripts open side by side must not collide.
    const id = `${sessionKey}#turn-${index}`
    if (turn.role === 'user') {
      messages.push({
        id,
        role: 'user',
        content: turn.items
          .filter(isTextItem)
          .map((item) => item.text)
          .join('\n\n'),
      })
      continue
    }
    messages.push({ id, role: 'assistant', items: [...turn.items] })
  }
  return messages
}
