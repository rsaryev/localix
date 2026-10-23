import { createRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'

import type { BoardEvent } from '../../shared/contracts'
import { BOARD_FRAME_TAG, BOARD_SUBSCRIBE, BOARD_UNSUBSCRIBE } from '../../shared/resource'

/**
 * The live side of a board: every change to ONE chat's board, whoever made it — the person in
 * another window, or the agent's tool. Keyed by chat, so a frame reaches only the board it names.
 *
 * The SDK's feed owns what every stream needs (one listener, one subscription per chat however
 * many surfaces follow it, a resubscribe and a re-read after a reconnect). A refused subscribe (a
 * chat that is not this user's, or is gone) leaves the board showing what its last read said.
 */
export const boardFeed = createRealtimeFeed<string, BoardEvent>({
  tag: BOARD_FRAME_TAG,
  subscribe: (sessionId) => ({ t: BOARD_SUBSCRIBE, sessionId }),
  unsubscribe: (sessionId) => ({ t: BOARD_UNSUBSCRIBE, sessionId }),
  decode: (json) => JSON.parse(json) as BoardEvent,
  route: (event) => event.sessionId,
})
