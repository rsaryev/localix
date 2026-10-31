import { describe, expect, test } from 'bun:test'

import { updateProviderConnectionRequestSchema } from './contracts'

describe('PATCH /rpc/provider-connections/:id', () => {
  test('does not take an api key: keys are rotated through their own routes', () => {
    const parsed = updateProviderConnectionRequestSchema.parse({ label: 'Work', apiKey: 'sk-new' })
    expect(parsed).toEqual({ label: 'Work' })
  })
})
