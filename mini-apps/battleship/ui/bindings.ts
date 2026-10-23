import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'

import { describeForChat } from '../shared/describe'
import type { PlayerView } from '../shared/game'

/**
 * The board as the person sees it, for a message they send while looking at it — "where should I
 * fire?" is answered from the real shots, not from a board the agent imagines. Built with
 * `describeForChat`, which leaves out the person's fleet: this text is read by the agent.
 */
export function gameMessageContext(view: PlayerView): PublishedMessageContext {
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        label: 'Battleship board',
        language: 'text',
        content: describeForChat(view),
      }),
    ],
  }
}
