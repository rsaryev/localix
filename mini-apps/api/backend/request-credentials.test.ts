import { describe, expect, test } from 'bun:test'
import {
  credentialHeaders,
  credentialQueryPairs,
  credentialUrlParams,
  redactUrlCredentials,
} from './request-spec'

describe('credential name boundaries', () => {
  test('preserves pair identity and includes disabled credentials with nonblank values', () => {
    const header = { name: ' Authorization ', value: 'token', disabled: true }
    const query = { name: ' ACCESS_TOKEN ', value: 'token', disabled: true }
    expect(credentialHeaders([header, { name: 'Cookie', value: '  ' }])).toEqual([header])
    expect(credentialHeaders([header])[0]).toBe(header)
    expect(credentialQueryPairs([query, { name: 'token', value: '  ' }])).toEqual([query])
    expect(credentialQueryPairs([query])[0]).toBe(query)
    expect(credentialHeaders([{ name: 'X-Trace', value: 'token' }])).toEqual([])
    expect(credentialQueryPairs([{ name: 'key', value: 'token' }])).toEqual([])
  })

  test('reads template URL credentials without decoding names or changing separators', () => {
    const url = '{{base}}/:id?token=first;access_token=second&token=third&%74oken=encoded&key=plain'
    expect(credentialUrlParams(url)).toEqual([
      { name: 'token', value: 'first' },
      { name: 'access_token', value: 'second' },
      { name: 'token', value: 'third' },
    ])
    expect(redactUrlCredentials(url, 'REDACTED')).toBe(
      '{{base}}/:id?token=REDACTED;access_token=REDACTED&token=REDACTED&%74oken=encoded&key=plain',
    )
  })

  test('leaves blank values and parameters without an equals sign unchanged', () => {
    const url = '/path?token=&password=   ;secret&=bad&ordinary=a=b'
    expect(credentialUrlParams(url)).toEqual([])
    expect(redactUrlCredentials(url, 'REDACTED')).toBe(url)
    expect(redactUrlCredentials('/path', 'REDACTED')).toBe('/path')
  })
})
