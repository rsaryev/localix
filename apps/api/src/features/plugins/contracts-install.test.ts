import { describe, expect, test } from 'bun:test'

import { installPluginRequestSchema } from './contracts'

describe('installPluginRequestSchema', () => {
  test('explicit installation enables the plugin by default', () => {
    expect(installPluginRequestSchema.parse({ source: '/tmp/example' }).enable).toBe(true)
  })

  test('an explicit disabled install remains supported', () => {
    expect(installPluginRequestSchema.parse({ source: '/tmp/example', enable: false }).enable).toBe(
      false,
    )
  })
})
