import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { describeGame } from '../shared/describe'
import type { Game } from '../shared/game'

/** The board on screen, as the message context a question typed beside it carries. */
export function gameMessageContext(game: Game): PublishedMessageContext {
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        label: 'Snake board',
        language: 'text',
        content: describeGame(game),
      }),
    ],
  }
}
