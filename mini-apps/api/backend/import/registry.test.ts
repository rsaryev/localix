/**
 * The chain itself: does the right importer claim each payload, and does a bad one stay contained.
 */

import { describe, expect, test } from 'bun:test'
import { importerNames, runImport } from './registry'
import { curlImporter } from './curl'
import type { Importer } from './types'

describe('runImport', () => {
  test('a curl command is claimed by the curl importer', () => {
    const out = runImport('curl https://api.github.com/users/octocat')!
    expect(out.importer.id).toBe('curl')
    expect(out.requests).toHaveLength(1)
  })

  test('a HAR is claimed by the har importer', () => {
    const out = runImport(
      JSON.stringify({
        log: { entries: [{ request: { method: 'GET', url: 'https://api.dev/x' } }] },
      }),
    )!
    expect(out.importer.id).toBe('har')
  })

  test('an unrecognised payload returns null rather than a wrong guess', () => {
    expect(runImport('GET /users HTTP/1.1')).toBeNull()
    expect(runImport('{"info":{"name":"postman"}}')).toBeNull()
    expect(runImport('')).toBeNull()
  })

  test('an empty-but-claimed payload does not shadow a later importer', () => {
    // A HAR with no entries returns [], which is "mine but empty" — the chain keeps looking
    // rather than reporting a successful import of nothing.
    expect(runImport(JSON.stringify({ log: { entries: [] } }))).toBeNull()
  })
})

describe('a broken importer cannot break the chain', () => {
  const exploding: Importer = {
    id: 'boom',
    name: 'Exploding',
    convert() {
      throw new Error('importer bug')
    },
  }

  test('a throwing importer is stepped past, and a later one still claims', () => {
    // Calls the REAL `runImport` with the broken one FIRST. The previous version of this test
    // re-implemented the try/catch in its own body and never called `runImport` at all — deleting
    // the guard it claimed to test would not have failed it.
    const out = runImport('curl https://api.dev/x', undefined, [exploding, curlImporter])
    expect(out?.importer.id).toBe('curl')
  })

  test('a throwing `notes` does not lose an import that already succeeded', () => {
    const noisy: Importer = {
      ...curlImporter,
      notes() {
        throw new Error('notes bug')
      },
    }
    const out = runImport('curl https://api.dev/x', undefined, [noisy])
    expect(out?.requests).toHaveLength(1)
    expect(out?.notes).toEqual([])
  })

  test('every importer throwing is "nobody claimed it", not a crash', () => {
    expect(runImport('curl https://api.dev/x', undefined, [exploding])).toBeNull()
  })

  test('the REAL chain survives any string', () => {
    for (const text of [
      'curl',
      'curl -X',
      '{',
      '{"log":{"entries":null}}',
      ' ',
      '{"openapi":"3.0.0"}',
    ]) {
      expect(() => runImport(text)).not.toThrow()
    }
  })
})

describe('importerNames', () => {
  test('names every format, for the fix-it message', () => {
    expect(importerNames()).toContain('cURL')
    expect(importerNames()).toContain('HAR')
  })
})
