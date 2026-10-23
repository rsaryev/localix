import { sessionResourceAddress } from '@localixai/mini-app-sdk/session-resource'

/** The router's mount path: `/rpc/<mini app name>`, so it is this mini app's own. */
export const ROUTE_PATH = '/rpc/chess'

const game = sessionResourceAddress('chess', 'game')

/**
 * One chat's board. The new-game tool opens THIS, naming the session it runs in, so the board
 * opens in that chat even if the person has since switched to another.
 */
export const gameUri = game.forSession

/** The session a board URI names, `null` for the bare one, `undefined` for another URI. */
export const sessionOfGameUri = game.sessionOf

/** The board's work item: one per chat session (`scope: 'session'`). */
export const GAME_KIND = 'chess:game'
