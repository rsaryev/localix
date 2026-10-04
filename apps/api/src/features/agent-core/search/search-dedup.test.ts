import { describe, expect, it } from 'bun:test'
import {
  createSearchDedupStore,
  searchOutputFingerprint,
  searchDedupStub,
  SEARCH_DEDUP_STUB_PHRASE,
  type SearchKey,
} from './search-dedup'

const key = (over: Partial<SearchKey> = {}): SearchKey => ({
  query: 'createFoo',
  cwd: '/repo/src',
  ...over,
})

describe('search dedup store', () => {
  it('reports an identical search with identical output as unchanged', () => {
    const store = createSearchDedupStore()
    store.record(key(), 'a.ts:1:createFoo', 'call-1')
    expect(store.isUnchanged(key(), 'a.ts:1:createFoo')).toBe(true)
    expect(store.lastCallId(key())).toBe('call-1')
  })

  it('ignores rg\u2019s result ORDER — the same hits are the same answer', () => {
    const store = createSearchDedupStore()
    // Ripgrep's parallel walk really does return these two orders for one search.
    store.record(key(), 'a.ts:1:createFoo\nb.ts:9:createFoo', 'call-1')
    expect(store.isUnchanged(key(), 'b.ts:9:createFoo\na.ts:1:createFoo')).toBe(true)
  })

  it('does not dedup when the output CHANGED — the tree is live and that is news', () => {
    const store = createSearchDedupStore()
    store.record(key(), 'a.ts:1:createFoo', 'call-1')
    expect(store.isUnchanged(key(), 'a.ts:1:createFoo\nb.ts:9:createFoo')).toBe(false)
  })

  it('keys on every field that makes two searches different', () => {
    const store = createSearchDedupStore()
    const output = 'a.ts:1:createFoo'
    store.record(key(), output, 'call-1')

    // A different query is a DIFFERENT search, even a near-duplicate one.
    expect(store.isUnchanged(key({ query: 'createFoo\\(' }), output)).toBe(false)
    // A different scope can legitimately return more.
    expect(store.isUnchanged(key({ glob: '*.ts' }), output)).toBe(false)
    expect(store.isUnchanged(key({ cwd: '/repo/other' }), output)).toBe(false)
    // `context` changes what comes back, so it cannot share an entry.
    expect(store.isUnchanged(key({ context: 3 }), output)).toBe(false)
    // ...and the original still matches.
    expect(store.isUnchanged(key(), output)).toBe(true)
  })

  it('cannot confuse two keys whose fields concatenate the same way', () => {
    const store = createSearchDedupStore()
    const output = 'hit'
    store.record(key({ query: 'a', glob: 'b' }), output, 'call-1')
    expect(store.isUnchanged(key({ query: 'ab' }), output)).toBe(false)
  })

  it('normalizes the cwd as the path it is', () => {
    const store = createSearchDedupStore()
    store.record(key({ cwd: '/repo/src' }), 'hit', 'call-1')
    expect(store.isUnchanged(key({ cwd: '/repo/lib/../src' }), 'hit')).toBe(true)
  })

  it('tracks stubServed per key for the no-wire fallback', () => {
    const store = createSearchDedupStore()
    store.record(key(), 'hit', 'call-1')
    expect(store.stubServed(key())).toBe(false)
    store.setStubServed(key(), true)
    expect(store.stubServed(key())).toBe(true)
    expect(store.stubServed(key({ query: 'other' }))).toBe(false)
  })

  it('re-recording rearms the stub', () => {
    const store = createSearchDedupStore()
    store.record(key(), 'hit', 'call-1')
    store.setStubServed(key(), true)
    store.record(key(), 'hit', 'call-2')
    expect(store.stubServed(key())).toBe(false)
    expect(store.lastCallId(key())).toBe('call-2')
  })
})

describe('searchDedupStub', () => {
  it('names the query, points at the earlier result, and gives the better move', () => {
    const text = searchDedupStub(key({ glob: '*.ts' }))
    expect(text).toContain(SEARCH_DEDUP_STUB_PHRASE)
    expect(text).toContain('createFoo')
    expect(text).toContain('*.ts')
    // The recovery path must survive any reword — without it an elided search is lost.
    expect(text).toContain('search again')
    // The suggested alternatives, not a bare refusal.
    expect(text).toContain('context')
  })
})

describe('searchOutputFingerprint', () => {
  it('is stable across order but moves on any real change', () => {
    const fp = searchOutputFingerprint
    expect(fp('a\nb')).toBe(fp('b\na'))
    expect(fp('a\nb')).not.toBe(fp('a\nb\nc')) // a hit appeared
    expect(fp('a:1:x')).not.toBe(fp('a:1:y')) // a hit's text changed
    expect(fp('a\nb')).not.toBe(fp('a')) // a hit disappeared
  })
})
