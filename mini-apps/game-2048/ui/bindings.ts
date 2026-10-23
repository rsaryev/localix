import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { describeGame } from '../shared/describe'
import type { Game } from '../shared/game'

export function gameMessageContext(game: Game): PublishedMessageContext {
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        label: '2048 board',
        language: 'text',
        content: describeGame(game),
      }),
    ],
  }
}
