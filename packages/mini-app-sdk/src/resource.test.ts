import { describe, expect, test } from 'bun:test'
import { parseLocalixResourceUri } from './resource'

describe('resource URIs, as a mini app reads them', () => {
  // The SDK parser and `@localixai/uri` share one canonical spelling: an uppercase provider is not
  // folded to lowercase but refused, the way `parseLocalixUri` refuses it.
  test('require the canonical lowercase provider', () => {
    expect(parseLocalixResourceUri('localix://resource/DB/x')).toBeNull()
    expect(parseLocalixResourceUri('localix://resource/fixture-db/x')).toMatchObject({
      provider: 'fixture-db',
    })
  })
})
