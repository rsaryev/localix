import { describe, expect, test } from 'bun:test'

import { makePluginUi } from './native'

describe('native plugin UI intents', () => {
  test('builds a fresh automatic request for a plugin-owned resource', () => {
    const before = Date.now()
    const request = makePluginUi().open({
      uri: 'localix://resource/fixture-course/bun-deep-dive',
      label: 'Open course',
      description: 'Continue in the course workspace',
    })

    expect(request).toMatchObject({
      type: 'ui.navigate.request',
      uri: 'localix://resource/fixture-course/bun-deep-dive',
      label: 'Open course',
    })
    expect(request.issuedAt).toBeGreaterThanOrEqual(before)
  })

  test('keeps offered destinations user-driven and rejects write-action URIs', () => {
    expect(
      makePluginUi().offer({
        uri: 'localix://ui/settings/plugins',
        label: 'Open plugins',
      }),
    ).toEqual({
      type: 'ui.navigate',
      uri: 'localix://ui/settings/plugins',
      label: 'Open plugins',
    })
    expect(() =>
      makePluginUi().open({
        uri: 'localix://ui/action/command/plugins.enable',
        label: 'Enable plugin',
      }),
    ).toThrow('Expected a canonical read-only')
  })
})
