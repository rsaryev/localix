import { describe, expect, test } from 'bun:test'

import { installRequestSchema, listingsQuerySchema } from './index'

describe('the /rpc/store bodies', () => {
  test('a listings query names a shelf that exists, or none', () => {
    expect(listingsQuerySchema.parse({ shelf: 'capability:skill', q: 'review' })).toEqual({
      shelf: 'capability:skill',
      q: 'review',
      limit: 40,
    })
    expect(listingsQuerySchema.safeParse({ shelf: 'package:gadget' }).success).toBe(false)
  })

  test('a listings query pages by a cursor, 40 at a time unless it asks for more', () => {
    expect(listingsQuerySchema.parse({ cursor: 'abc' })).toEqual({ cursor: 'abc', limit: 40 })
    expect(listingsQuerySchema.parse({ limit: '200' }).limit).toBe(200)
    expect(listingsQuerySchema.safeParse({ limit: '5000' }).success).toBe(false)
  })

  test('a listings query narrows by category, source, trust and the open project', () => {
    expect(
      listingsQuerySchema.parse({
        category: 'Data',
        source: 'claude-plugins-official',
        trust: 'official',
        projectId: 'p1',
      }),
    ).toEqual({
      category: 'Data',
      source: 'claude-plugins-official',
      trust: 'official',
      projectId: 'p1',
      limit: 40,
    })
    expect(listingsQuerySchema.safeParse({ category: 'Gadgets' }).success).toBe(false)
    expect(listingsQuerySchema.safeParse({ trust: 'mine' }).success).toBe(false)
  })

  test('an install is for the person and without consent unless it says otherwise', () => {
    expect(installRequestSchema.parse({})).toEqual({ scope: 'user', consent: { plan: false } })
    expect(installRequestSchema.parse({ scope: 'project', consent: { plan: true } })).toEqual({
      scope: 'project',
      consent: { plan: true },
    })
  })
})
