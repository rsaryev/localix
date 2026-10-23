import { sessionResourceAddress } from '@localixai/mini-app-sdk/session-resource'

/** The router's mount path: `/rpc/<mini app name>`, so it is this mini app's own. */
export const ROUTE_PATH = '/rpc/rock-paper-scissors'

const game = sessionResourceAddress('rock-paper-scissors', 'game')

/**
 * One chat's table. The new-round tool opens THIS, naming the session it runs in, so the table
 * opens in that chat even if the person has since switched to another.
 */
export const gameUri = game.forSession

/** The session a table URI names, `null` for the bare one, `undefined` for another URI. */
export const sessionOfGameUri = game.sessionOf

/** The table's work item: one per chat session (`scope: 'session'`). */
export const GAME_KIND = 'rock-paper-scissors:game'
