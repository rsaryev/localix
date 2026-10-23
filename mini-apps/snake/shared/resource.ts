import { sessionResourceAddress } from '@localixai/mini-app-sdk/session-resource'

export const ROUTE_PATH = '/rpc/snake'
const game = sessionResourceAddress('snake', 'game')
export const gameUri = game.forSession
export const sessionOfGameUri = game.sessionOf
export const GAME_KIND = 'snake:game'
