/**
 * A Postman environment export — a file with no requests in it, which is why it did not work.
 *
 * Verified against the reference's own two fixtures before this was written: `basic-input.json`
 * gives "Production Env" with a disabled value preserved, `no-name-input.json` falls back to a name.
 */

import { describe, expect, test } from 'bun:test'
import {
  convertPostmanEnv,
  environmentValues,
  postmanEnvironments,
  postmanEnvNotes,
} from './postman-env'
import { runImport } from './registry'

const env = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'Production Env',
    _postman_variable_scope: 'environment',
    values: [{ key: 'base_url', value: 'https://api.dev', enabled: true }],
    ...over,
  })

describe('sniffing', () => {
  test.each(['environment', 'globals'])('scope %p is claimed', (scope) => {
    expect(convertPostmanEnv(env({ _postman_variable_scope: scope }))).toEqual([])
  })

  test('CLAIMED with zero requests — returning null would hand it to an importer that cannot read it', () => {
    // The distinction the chain turns on: null means "not mine". This file IS ours; it just has no
    // requests, because a Postman environment never does.
    expect(convertPostmanEnv(env())).not.toBeNull()
  })

  test.each([
    [JSON.stringify({ name: 'x', values: [] }), 'no scope marker'],
    [
      JSON.stringify({ _postman_variable_scope: 'collection', values: [] }),
      'a scope we do not read',
    ],
    [JSON.stringify({ _postman_variable_scope: 'environment' }), 'no values array'],
    [
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      }),
      'a COLLECTION, not an environment',
    ],
    ['not json', 'not json'],
    ['curl https://api.dev', 'a curl command'],
  ])('%p is not claimed (%s)', (text) => {
    expect(convertPostmanEnv(text)).toBeNull()
  })
})

describe('the values become our pairs', () => {
  test('a plain value', () => {
    expect(postmanEnvironments(env())).toEqual([
      { name: 'Production Env', variables: [{ name: 'base_url', value: 'https://api.dev' }] },
    ])
  })

  test('a DISABLED value is kept, switched off rather than dropped', () => {
    // Filtering `enabled: false` away would silently delete a variable the person can still see in
    // Postman and would have to retype. Our environments hold `disabled` as saved-but-inactive,
    // exactly like our headers do.
    expect(environmentValues([{ key: 'old', value: 'x', enabled: false }])).toEqual([
      { name: 'old', value: 'x', disabled: true },
    ])
  })

  test.each([
    [8080, '8080'],
    [true, 'true'],
    [0, '0'],
  ])('a non-string value %p becomes %p rather than vanishing', (value, expected) => {
    expect(environmentValues([{ key: 'k', value }])[0].value).toBe(expected)
  })

  test.each([
    [{ key: '', value: 'v' }, 'a blank key'],
    [{ key: '  ', value: 'v' }, 'a whitespace key'],
    [{ value: 'v' }, 'no key at all'],
  ])('%j contributes nothing (%s)', (v) => {
    expect(environmentValues([v])).toEqual([])
  })

  test('an object value becomes empty rather than "[object Object]"', () => {
    expect(environmentValues([{ key: 'k', value: { a: 1 } }])[0].value).toBe('')
  })

  test('a nameless export gets a fallback name', () => {
    expect(postmanEnvironments(env({ name: undefined }))[0].name).toBe('postman')
  })

  test('an export with no usable values yields no environment — nothing to import', () => {
    expect(postmanEnvironments(env({ values: [] }))).toEqual([])
  })
})

describe('a value Postman marked SECRET is named', () => {
  test('the variable keeps its secret type for native-Vault import', () => {
    expect(
      environmentValues([{ key: 'token', value: 'hidden', enabled: true, type: 'secret' }]),
    ).toEqual([{ name: 'token', value: 'hidden', secret: true }])
  })

  test('the note explains the native Vault mapping', () => {
    const notes = postmanEnvNotes(
      env({ values: [{ key: 'token', value: '', enabled: true, type: 'secret' }] }),
    )
    expect(notes[0]).toContain('`token`')
    expect(notes[0]).toContain('native Vault')
  })

  test('an ordinary export says nothing', () => {
    expect(postmanEnvNotes(env())).toEqual([])
  })
})

describe('the chain claims it — the whole point', () => {
  test('runImport returns an outcome with environments and no requests', () => {
    // This is what used to fail: `runImport` claimed a source only when it produced REQUESTS, so
    // this file fell past every importer and came back "format not recognised".
    const out = runImport(env())
    expect(out).not.toBeNull()
    expect(out!.importer.id).toBe('postman-env')
    expect(out!.requests).toEqual([])
    expect(out!.environments).toHaveLength(1)
  })

  test('a source that yields NOTHING is still not a match', () => {
    // The guard that must survive: claimed-but-completely-empty should let the chain keep looking.
    expect(runImport(env({ values: [] }))).toBeNull()
  })

  test('a Postman COLLECTION still goes to the collection importer', () => {
    const collection = JSON.stringify({
      info: {
        name: 'C',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [{ name: 'r', request: { method: 'GET', url: 'https://api.dev/x' } }],
    })
    expect(runImport(collection)?.importer.id).toBe('postman')
  })
})
