import { describe, expect, test } from 'bun:test'
import { ELEMENT_TYPES } from '../../shared/types'
import { ELEMENT_VIEWS } from './index'

/**
 * A type is two halves — its spec (data) and its view — registered in two lists. A spec without
 * a view would be accepted by the agent's tool and drawn as a placeholder forever; a view without
 * a spec would never be reached. The lists must name the same types.
 */
describe('element types', () => {
  test('every spec has a view and every view a spec', () => {
    const specs = ELEMENT_TYPES.map((spec) => spec.type).sort()
    const views = ELEMENT_VIEWS.map((view) => view.type).sort()
    expect(views).toEqual(specs)
  })

  test('a type is registered once', () => {
    const views = ELEMENT_VIEWS.map((view) => view.type)
    expect(new Set(views).size).toBe(views.length)
  })
})
