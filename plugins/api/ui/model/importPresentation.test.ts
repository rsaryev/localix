import { describe, expect, test } from 'bun:test'
import { importMessageForUi } from './importPresentation'

describe('import UI message', () => {
  test('keeps the preview and removes the agent re-run instruction', () => {
    expect(
      importMessageForUi(
        'Recognised cURL command — 1 request. Not saved yet.\n\napi-users: GET https://api.dev/users\n\nRe-run with {"action":"import","save":true} to store these.',
      ),
    ).toBe(
      'Recognised cURL command — 1 request. Not saved yet.\n\napi-users: GET https://api.dev/users',
    )
  })

  test('keeps warnings that follow the instruction', () => {
    expect(
      importMessageForUi(
        'Recognised OpenAPI.\n\nRe-run with {"action":"import"}.\n\nThe spec declares a relative server.',
      ),
    ).toBe('Recognised OpenAPI.\n\nThe spec declares a relative server.')
  })

  test('drops the irrelevant manual tool-call tail from an error', () => {
    expect(
      importMessageForUi(
        'Could not recognise the source. Paste a cURL command. To build a request by hand instead, use {"action":"save",…}.',
      ),
    ).toBe('Could not recognise the source. Paste a cURL command.')
  })
})
