/**
 * `$ref` resolution.
 *
 * The module claims two things the reference gets wrong, and until now neither was guarded —
 * `unescapePointerSegment` was exported and never called by a test, so deleting the `~1` → `/`
 * replace would have passed everything.
 */

import { describe, expect, test } from 'bun:test'
import { isLocalRef, pointerGet, resolveRef, unescapePointerSegment } from './pointer'
import type { OASchema } from './types'

describe('JSON-pointer escapes (RFC 6901) — a naive split shatters these', () => {
  // A resolver that is just `$ref.split('/')` with no unescaping would split a pointer at a key
  // that CONTAINS a slash — `#/paths/~1users~1{id}`, the idiomatic way to $ref a path item — into
  // three segments and resolve it to undefined.
  const doc = {
    paths: { '/users/{id}': { get: { operationId: 'getUser' } } },
    components: { schemas: { 'A~B': { type: 'string' }, 'a/b': { type: 'integer' } } },
  }

  test('~1 is a literal slash — a path-item $ref resolves', () => {
    expect(pointerGet(doc, '#/paths/~1users~1{id}/get')).toEqual({ operationId: 'getUser' })
  })

  test('~0 is a literal tilde', () => {
    expect(pointerGet(doc, '#/components/schemas/A~0B')).toEqual({ type: 'string' })
  })

  test.each([
    ['a~1b', 'a/b'],
    ['a~0b', 'a~b'],
    ['a~1b~0c', 'a/b~c'],
    // Order matters: ~01 must be `~1` the literal, NOT unescape twice into `/`.
    ['a~01b', 'a~1b'],
    ['plain', 'plain'],
    ['', ''],
  ])('unescape %p → %p', (raw, expected) => {
    expect(unescapePointerSegment(raw)).toBe(expected)
  })

  test('the naive split this replaces would NOT find it', () => {
    // Pinning the difference itself: if someone "simplifies" pointerGet to a plain split, the test
    // above goes red and this one explains why.
    const naive = (d: unknown, ref: string) =>
      ref
        .split('/')
        .slice(1)
        .reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], d)
    expect(naive(doc, '#/paths/~1users~1{id}/get')).toBeUndefined()
  })
})

describe('pointerGet', () => {
  const doc = { components: { schemas: { Pet: { type: 'object' } } }, arr: [{ x: 1 }] }

  test('walks a path', () => {
    expect(pointerGet(doc, '#/components/schemas/Pet')).toEqual({ type: 'object' })
  })

  test('an array index is just a segment', () => {
    expect(pointerGet(doc, '#/arr/0')).toEqual({ x: 1 })
  })

  test.each([
    '#/components/nope',
    '#/components/schemas/Pet/deeper',
    '#',
    'components/schemas/Pet',
    '',
  ])('%p resolves to null rather than throwing', (ref) => {
    expect(pointerGet(doc, ref)).toBeNull()
  })

  test('`#/` is the DOCUMENT ROOT, not null', () => {
    // I expected null here and was wrong. RFC 6901: the empty pointer IS the root, and the
    // empty-segment filter — which exists so a trailing slash cannot break a real ref — makes
    // `#/` and `#` mean the same thing. Harmless in practice: `resolveRef` hands the document to a
    // schema walk, which finds no `type` or `properties` and yields undefined. Asserted rather
    // than "fixed", because the leniency is deliberate and nobody writes `$ref: '#/'`.
    expect(pointerGet(doc, '#/')).toBe(doc)
  })

  test('an EXTERNAL ref is not followed — an importer must not fetch from a paste', () => {
    expect(pointerGet(doc, 'https://evil.dev/schema.json#/x')).toBeNull()
    expect(pointerGet(doc, './other.yaml#/x')).toBeNull()
  })

  test.each(['#/a', '#/'])('isLocalRef(%p) is true', (ref) => {
    expect(isLocalRef(ref)).toBe(true)
  })

  test.each(['https://x.dev#/a', './y.yaml#/a', '#a', 'a'])('isLocalRef(%p) is false', (ref) => {
    expect(isLocalRef(ref)).toBe(false)
  })
})

describe('resolveRef follows a chain, and stops', () => {
  test('a node that is not a ref is returned as-is', () => {
    const node: OASchema = { type: 'string' }
    expect(resolveRef({}, node)).toBe(node)
  })

  test('one hop', () => {
    const doc = { components: { schemas: { A: { type: 'string' } } } }
    expect(resolveRef<OASchema>(doc, { $ref: '#/components/schemas/A' })).toEqual({
      type: 'string',
    })
  })

  test('a CHAIN of refs is followed to the end', () => {
    const doc = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/C' },
          C: { type: 'string' },
        },
      },
    }
    expect(resolveRef<OASchema>(doc, { $ref: '#/components/schemas/A' })).toEqual({
      type: 'string',
    })
  })

  test('a ref LOOP resolves to null instead of spinning', () => {
    // The MAX_HOPS cap. `example.ts` has its own seen-set for schema cycles; this is the other
    // kind — `A.$ref → B.$ref → A` with no schema in between — and nothing else would stop it.
    const doc = {
      components: {
        schemas: { A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' } },
      },
    }
    expect(resolveRef<OASchema>(doc, { $ref: '#/components/schemas/A' })).toBeNull()
  })

  test('a self-referencing ref terminates', () => {
    const doc = { components: { schemas: { A: { $ref: '#/components/schemas/A' } } } }
    expect(resolveRef<OASchema>(doc, { $ref: '#/components/schemas/A' })).toBeNull()
  })

  test.each([undefined, null])('%p resolves to null', (node) => {
    expect(resolveRef({}, node as never)).toBeNull()
  })

  test('an unresolvable ref is null, not a throw', () => {
    expect(resolveRef<OASchema>({}, { $ref: '#/nope' })).toBeNull()
  })
})
