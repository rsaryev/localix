/**
 * The `localix://resource/api` grammar. The invariants worth pinning are round-tripping (a name
 * with awkward characters survives) and refusing what we never minted.
 */

import { describe, expect, test } from 'bun:test'
import { buildCollectionUri, buildRequestUri, parseRestUri } from './uri'
import { PROVIDER } from './resource-provider-id'

describe('the provider comes from the shared vocabulary', () => {
  test('it is `api`', () => {
    // `uri.ts` writes the segment inline: it must stay off the backend barrel for the browser
    // (see its header and uri.provider.test.ts). The backend-only owner derives it.
    expect(PROVIDER).toBe('api')
  })
})

describe('the collection level', () => {
  test('the bare provider URI is the collection, not a malformed request', () => {
    expect(buildCollectionUri()).toBe('localix://resource/api')
    expect(parseRestUri(buildCollectionUri())).toEqual({ kind: 'collection' })
  })
})

describe('round-trip', () => {
  test.each([
    'github-user',
    'api-v1-things-2',
    'a name with spaces',
    'weird/name#with?chars',
    'unicode-\u03a9-name',
    '..dots',
  ])('%p survives build → parse', (name) => {
    const uri = buildRequestUri(name)
    expect(parseRestUri(uri)).toEqual({ kind: 'request', name })
  })

  test('a name is encoded into ONE segment — a slash never splits it', () => {
    const uri = buildRequestUri('weird/name')
    expect(uri).toBe('localix://resource/api/weird%2Fname')
    expect(parseRestUri(uri)).toEqual({ kind: 'request', name: 'weird/name' })
  })
})

describe('parseRestUri refuses what we never minted', () => {
  test.each([
    ['localix://resource/trade/BTC', 'another mini app’s provider'],
    ['localix://resource/api/a/b', 'a second segment — our tree is flat'],
    ['rest://github-user', 'the retired scheme'],
    ['not a uri', 'not a uri at all'],
    ['localix://resource/api/.', 'a bare dot'],
    ['localix://resource/api/..', 'a traversal segment'],
    ['localix://resource/api/%E0%A4%A', 'a malformed percent-escape'],
  ])('%p is rejected (%s)', (uri) => {
    expect(parseRestUri(uri)).toBeNull()
  })
})
