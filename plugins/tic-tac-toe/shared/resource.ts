import { sessionResourceAddress } from '@localixai/plugin-sdk/session-resource'

/** The router's mount path: `/rpc/<plugin name>`, so it is this plugin's own. */
export const ROUTE_PATH = '/rpc/tic-tac-toe'

const game = sessionResourceAddress('tic-tac-toe', 'game')

/** The board as a resource: what the launcher and the anchor resolve. */
export const GAME_URI = game.uri

/**
 * One chat's board. The new-game tool opens THIS, naming the session it runs in, so the board
 * opens in that chat even if the person has since switched to another.
 */
export const gameUri = game.forSession

/** The session a board URI names, `null` for the bare one, `undefined` for another URI. */
export const sessionOfGameUri = game.sessionOf

/** The board's work item: one per chat session (`scope: 'session'`). */
export const GAME_KIND = 'tic-tac-toe:game'
