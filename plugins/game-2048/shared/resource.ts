import { sessionResourceAddress } from '@localixai/plugin-sdk/session-resource'

export const ROUTE_PATH = '/rpc/game-2048'
const game = sessionResourceAddress('game-2048', 'game')
export const GAME_URI = game.uri
export const gameUri = game.forSession
export const sessionOfGameUri = game.sessionOf
export const GAME_KIND = 'game-2048:game'
