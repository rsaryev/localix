import { describe, expect, test } from 'bun:test'

import { installRequestSchema, listingsQuerySchema } from './index'

describe('the /rpc/store bodies', () => {
  test('a listings query names a shelf that exists, or none', () => {
    expect(listingsQuerySchema.parse({ shelf: 'capability:skill', q: 'review' })).toEqual({
      shelf: 'capability:skill',
      q: 'review',
    })
    expect(listingsQuerySchema.safeParse({ shelf: 'package:gadget' }).success).toBe(false)
  })

  test('an install is for the person and without consent unless it says otherwise', () => {
    expect(installRequestSchema.parse({})).toEqual({ scope: 'user', consent: { plan: false } })
    expect(installRequestSchema.parse({ scope: 'project', consent: { plan: true } })).toEqual({
      scope: 'project',
      consent: { plan: true },
    })
  })
})
