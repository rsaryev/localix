import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'

import { describeGame } from '../shared/describe'
import type { Game } from '../shared/game'

/**
 * The board exactly as the person sees it, for a message they send while looking at it — "what
 * should I play?" is answered from this position, not from one the agent imagines.
 */
export function gameMessageContext(game: Game): PublishedMessageContext {
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        label: 'Chess board',
        language: 'text',
        content: describeGame(game),
      }),
    ],
  }
}
