import { describe, expect, it } from 'bun:test'
import { DIAGRAM_EAGER_CAP, diagramLoadPlan } from './diagramScope'

const catalogue = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: index % 2 ? `orders_${index}` : `users_${index}`,
    schema: 'public',
  }))

describe('diagramLoadPlan', () => {
  it('reads a small catalogue whole, as before the gate', () => {
    const objects = catalogue(DIAGRAM_EAGER_CAP)
    const plan = diagramLoadPlan(objects, '')
    expect(plan.kind).toBe('all')
    expect(plan.kind === 'all' && plan.wanted.length).toBe(DIAGRAM_EAGER_CAP)
  })

  it('reads nothing for a big catalogue until it is narrowed', () => {
    // The old diagram asked for all 5,000 structures the moment it was shown.
    const plan = diagramLoadPlan(catalogue(5_000), '')
    expect(plan).toEqual({ kind: 'gated', total: 5_000 })
  })

  it('does not count a one-character search as narrowing', () => {
    expect(diagramLoadPlan(catalogue(5_000), 'u').kind).toBe('gated')
  })

  it('reads only name matches, capped, for a searched big catalogue', () => {
    const plan = diagramLoadPlan(catalogue(5_000), 'users')
    expect(plan.kind).toBe('scoped')
    if (plan.kind !== 'scoped') return
    expect(plan.wanted).toHaveLength(DIAGRAM_EAGER_CAP)
    expect(plan.wanted.every((object) => object.name.startsWith('users_'))).toBe(true)
    expect(plan.truncated).toBe(true)
    expect(plan.total).toBe(5_000)
  })

  it("grows a gated diagram from a focused table's references", () => {
    const refs = [{ name: 'users_0', schema: 'public' }]
    const plan = diagramLoadPlan(catalogue(5_000), '', refs)
    expect(plan).toEqual({ kind: 'scoped', wanted: refs, total: 5_000, truncated: false })
  })
})
