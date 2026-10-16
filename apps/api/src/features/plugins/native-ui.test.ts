import { describe, expect, test } from 'bun:test'

import { makePluginUi } from './native'

describe('native plugin UI intents', () => {
  test('offers a user-driven destination and never an automatic reveal', () => {
    const ui = makePluginUi()

    expect(
      ui.offer({
        uri: 'localix://resource/fixture-course/bun-deep-dive',
        label: 'Open course',
        description: 'Continue in the course workspace',
      }),
    ).toEqual({
      type: 'ui.navigate',
      uri: 'localix://resource/fixture-course/bun-deep-dive',
      label: 'Open course',
      description: 'Continue in the course workspace',
    })
    expect('open' in ui).toBe(false)
  })

  test('rejects write-action URIs', () => {
    expect(() =>
      makePluginUi().offer({
        uri: 'localix://ui/action/command/plugins.enable',
        label: 'Enable plugin',
      }),
    ).toThrow('Expected a canonical read-only')
  })
})
