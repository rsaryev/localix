import { sessionResourceAddress } from '@localixai/mini-app-sdk/session-resource'

export const ROUTE_PATH = '/rpc/game-2048'
const game = sessionResourceAddress('game-2048', 'game')
export const gameUri = game.forSession
export const sessionOfGameUri = game.sessionOf
export const GAME_KIND = 'game-2048:game'
