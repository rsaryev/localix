import { describe, expect, it } from 'bun:test'
import {
  isFavoriteModel,
  toggleFavoriteModel,
  FAVORITE_MODELS_CAP,
  type FavoriteModel,
} from './favoriteModels'

const m = (connectionId: string, modelId: string): FavoriteModel => ({ connectionId, modelId })

describe('toggleFavoriteModel', () => {
  it('prepends a new favorite', () => {
    expect(toggleFavoriteModel([m('c1', 'a')], m('c1', 'b'))).toEqual([m('c1', 'b'), m('c1', 'a')])
  })

  it('removes an existing favorite when toggled again', () => {
    const list = [m('c1', 'b'), m('c1', 'a')]
    expect(toggleFavoriteModel(list, m('c1', 'b'))).toEqual([m('c1', 'a')])
  })

  it('treats the same model on a different connection as distinct', () => {
    const list = [m('c1', 'a')]
    expect(toggleFavoriteModel(list, m('c2', 'a'))).toEqual([m('c2', 'a'), m('c1', 'a')])
    // toggling off c1/a leaves c2/a untouched
    expect(toggleFavoriteModel([m('c2', 'a'), m('c1', 'a')], m('c1', 'a'))).toEqual([m('c2', 'a')])
  })

  it('caps the list, dropping the oldest', () => {
    const list = Array.from({ length: FAVORITE_MODELS_CAP }, (_, i) => m('c1', `model-${i}`))
    const next = toggleFavoriteModel(list, m('c1', 'fresh'))
    expect(next.length).toBe(FAVORITE_MODELS_CAP)
    expect(next[0]).toEqual(m('c1', 'fresh'))
    expect(next).not.toContainEqual(m('c1', `model-${FAVORITE_MODELS_CAP - 1}`))
  })
})

describe('isFavoriteModel', () => {
  it('detects membership by connection + model', () => {
    const list = [m('c1', 'a')]
    expect(isFavoriteModel(list, m('c1', 'a'))).toBe(true)
    expect(isFavoriteModel(list, m('c2', 'a'))).toBe(false)
    expect(isFavoriteModel(list, m('c1', 'b'))).toBe(false)
  })
})
