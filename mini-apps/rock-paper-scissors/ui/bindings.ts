import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'

import { describeForChat } from '../shared/describe'
import type { PlayerView } from '../shared/game'

/**
 * The table as the person sees it, for a message they send beside it. The agent reads this, so it
 * is `describeForChat`: the person's own move stays out of it until the round reveals it.
 */
export function gameMessageContext(view: PlayerView): PublishedMessageContext {
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        label: 'Rock Paper Scissors table',
        language: 'text',
        content: describeForChat(view),
      }),
    ],
  }
}
