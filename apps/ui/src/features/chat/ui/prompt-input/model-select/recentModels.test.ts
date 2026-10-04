import { describe, expect, it } from 'bun:test'
import { promoteRecentModel, RECENT_MODELS_CAP, type RecentModel } from './recentModels'

const m = (connectionId: string, modelId: string): RecentModel => ({ connectionId, modelId })

describe('promoteRecentModel', () => {
  it('moves a just-picked model to the front', () => {
    const list = [m('c1', 'a'), m('c1', 'b'), m('c2', 'a')]
    expect(promoteRecentModel(list, m('c2', 'a'))).toEqual([
      m('c2', 'a'),
      m('c1', 'a'),
      m('c1', 'b'),
    ])
  })

  it('adds a new model at the front', () => {
    expect(promoteRecentModel([m('c1', 'a')], m('c1', 'b'))).toEqual([m('c1', 'b'), m('c1', 'a')])
  })

  it('de-duplicates by connection + model, not model alone', () => {
    const list = [m('c1', 'a'), m('c2', 'a')]
    // same model id on a different connection is a distinct entry
    expect(promoteRecentModel(list, m('c1', 'a'))).toEqual([m('c1', 'a'), m('c2', 'a')])
  })

  it('caps the list, dropping the oldest', () => {
    const list = Array.from({ length: RECENT_MODELS_CAP }, (_, i) => m('c1', `model-${i}`))
    const next = promoteRecentModel(list, m('c1', 'fresh'))
    expect(next.length).toBe(RECENT_MODELS_CAP)
    expect(next[0]).toEqual(m('c1', 'fresh'))
    expect(next).not.toContainEqual(m('c1', `model-${RECENT_MODELS_CAP - 1}`))
  })

  it('dedupes value-equal entries even though they are distinct objects', () => {
    // The stored list is re-parsed from localStorage, so a re-pick is never the
    // same object reference as the entry already in the list.
    const list = [m('c1', 'a'), m('c1', 'b')]
    expect(promoteRecentModel(list, m('c1', 'a'))).toEqual([m('c1', 'a'), m('c1', 'b')])
  })

  it('drops entries with a blank id — they can never resolve to a live model', () => {
    expect(promoteRecentModel([m('', 'a'), m('c1', 'b')], m('c1', 'c'))).toEqual([
      m('c1', 'c'),
      m('c1', 'b'),
    ])
    expect(promoteRecentModel([m('c1', 'a')], m('c2', ''))).toEqual([m('c1', 'a')])
  })
})
