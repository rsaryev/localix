import { describe, expect, test } from 'bun:test'
import { filterJson } from './response-filter'

const BODY = JSON.stringify({
  data: {
    token: 'tok_123',
    users: [
      { id: 1, name: 'ada', active: true },
      { id: 2, name: 'grace', active: false },
      { id: 3, name: 'edsger', active: true },
    ],
  },
})

describe('what the filter is FOR — reaching one field of a large payload', () => {
  test('a top-level object uses $.id, not an invented data-array path', () => {
    const body = JSON.stringify({ userId: 1, id: 1, title: 'hello', body: 'world' })
    expect(filterJson(body, '$.id')).toEqual({ ok: true, content: '1', matches: 1 })
    expect(filterJson(body, '$.data[0].id')).toEqual({ ok: true, content: '', matches: 0 })
  })

  test('a single match unwraps to the value itself', () => {
    // Not `["tok_123"]`. Asking for the token should read as the token.
    expect(filterJson(BODY, '$.data.token')).toEqual({
      ok: true,
      content: '"tok_123"',
      matches: 1,
    })
  })

  test('several matches stay a list, because that is what they are', () => {
    const out = filterJson(BODY, '$.data.users[*].name')
    expect(out).toMatchObject({ ok: true, matches: 3 })
    expect(out.ok && JSON.parse(out.content)).toEqual(['ada', 'grace', 'edsger'])
  })

  test('a recursive descent reaches through the shape you did not memorise', () => {
    const out = filterJson(BODY, '$..id')
    expect(out).toMatchObject({ ok: true, matches: 3 })
  })

  test('an object match is pretty-printed, so the pane can show it as-is', () => {
    const out = filterJson(BODY, '$.data.users[0]')
    expect(out.ok && out.content).toBe(
      ['{', '  "id": 1,', '  "name": "ada",', '  "active": true', '}'].join('\n'),
    )
  })
})

describe('script expressions run WITHOUT eval', () => {
  test('a filter expression still works under `eval: "safe"`', () => {
    // The whole point of pinning `safe` rather than banning scripts: the syntax people actually
    // type keeps working, it is just parsed instead of executed.
    const out = filterJson(BODY, '$.data.users[?(@.active)].name')
    expect(out).toMatchObject({ ok: true, matches: 2 })
    expect(out.ok && JSON.parse(out.content)).toEqual(['ada', 'edsger'])
  })

  test('a comparison expression works too', () => {
    const out = filterJson(BODY, '$.data.users[?(@.id > 1)].id')
    expect(out.ok && JSON.parse(out.content)).toEqual([2, 3])
  })
})

describe('“no matches” and “wrong kind of body” are different answers', () => {
  test('a valid path that matches nothing is a SUCCESS with zero matches', () => {
    expect(filterJson(BODY, '$.data.missing')).toEqual({ ok: true, content: '', matches: 0 })
  })

  test('a non-JSON body is refused, and the refusal quotes what it actually was', () => {
    const out = filterJson('<!doctype html><html><body>hi</body></html>', '$.a')
    expect(out.ok).toBe(false)
    // Naming the body is what stops "no matches" from sending someone to debug their expression.
    expect(!out.ok && out.error).toContain('not JSON')
    expect(!out.ok && out.error).toContain('<!doctype html>')
  })

  test('an empty body is refused as not-JSON rather than crashing', () => {
    expect(filterJson('', '$.a').ok).toBe(false)
  })

  test('an empty expression asks for one instead of matching everything', () => {
    const out = filterJson(BODY, '   ')
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toContain('JSONPath')
  })

  test('a malformed SCRIPT expression names itself, and never throws', () => {
    const out = filterJson(BODY, '$[?(')
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toContain('valid JSONPath')
  })

  test('a broken PATH is never an error — it silently matches, or matches nothing', () => {
    // Characterizing the library, not endorsing it. Only a broken SCRIPT expression throws;
    // a broken path is recovered from, and the recovery is not always empty:
    //   `$$$` / `not a path` → nothing,
    //   `$.data[`            → the library drops the dangling `[` and answers `$.data`.
    // Both shapes reach the caller as a successful filter, which is exactly why neither caller
    // may report "not found": it cannot tell a typo from an absent field.
    for (const typo of ['$$$', 'not a path']) {
      expect(filterJson(BODY, typo)).toEqual({ ok: true, content: '', matches: 0 })
    }
    const recovered = filterJson(BODY, '$.data[')
    expect(recovered).toMatchObject({ ok: true, matches: 1 })
    expect(recovered.ok && JSON.parse(recovered.content).token).toBe('tok_123')
  })

  test('an implicit root is a REAL form, so it must keep working', () => {
    // The reason no `$`-prefix guard exists: this matches.
    expect(filterJson(BODY, 'data.token')).toEqual({ ok: true, content: '"tok_123"', matches: 1 })
  })
})

describe('a body that is JSON but not an object', () => {
  test('a top-level array filters', () => {
    const out = filterJson('[{"id":1},{"id":2}]', '$[*].id')
    expect(out.ok && JSON.parse(out.content)).toEqual([1, 2])
  })

  test('a bare scalar body still answers `$`', () => {
    expect(filterJson('42', '$')).toEqual({ ok: true, content: '42', matches: 1 })
  })

  test('a JSON `null` body is JSON, not a parse failure', () => {
    // `JSON.parse('null')` succeeds, so this must not be mistaken for an unparseable body.
    expect(filterJson('null', '$')).toMatchObject({ ok: true })
  })
})
