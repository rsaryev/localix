import { sessionResourceAddress } from '@localixai/plugin-sdk/session-resource'

export const ROUTE_PATH = '/rpc/snake'
const game = sessionResourceAddress('snake', 'game')
export const GAME_URI = game.uri
export const gameUri = game.forSession
export const sessionOfGameUri = game.sessionOf
export const GAME_KIND = 'snake:game'
