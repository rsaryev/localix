import { describe, expect, it } from 'bun:test'
import { parseEsCommand, shapeEsResult, targetEsRequest } from './es-query'

describe('parseEsCommand', () => {
  it('parses search with a body', () => {
    expect(parseEsCommand('products.search({"query":{"match_all":{}}})')).toEqual({
      index: 'products',
      method: 'search',
      args: [{ query: { match_all: {} } }],
    })
  })
  it('parses get by id and no-arg count', () => {
    expect(parseEsCommand('logs.get("abc")').args).toEqual(['abc'])
    expect(parseEsCommand('logs.count()').args).toEqual([])
  })
  it('rejects malformed / unknown method / bad JSON', () => {
    expect(() => parseEsCommand('nope')).toThrow()
    expect(() => parseEsCommand('i.delete()')).toThrow(/Unsupported/)
    expect(() => parseEsCommand('i.search({query: 1})')).toThrow(/valid JSON/)
  })
  it('rejects arguments the driver would otherwise ignore or silently coerce', () => {
    expect(() => parseEsCommand('i.search("query")')).toThrow(/JSON object/)
    expect(() => parseEsCommand('i.search({}, {})')).toThrow(/at most one/)
    expect(() => parseEsCommand('i.count([])')).toThrow(/JSON object/)
    expect(() => parseEsCommand('i.get()')).toThrow(/document id/)
    expect(() => parseEsCommand('i.get(123)')).toThrow(/document id/)
    expect(() => parseEsCommand('i.get("a", "b")')).toThrow(/document id/)
  })
  it('keeps long numeric query literals exact instead of rounding them before transport', () => {
    expect(
      parseEsCommand(
        'products.search({"query":{"term":{"serial":9223372036854775807}},"min_score":0.1234567890123456789})',
      ).args,
    ).toEqual([
      {
        query: { term: { serial: '9223372036854775807' } },
        min_score: '0.1234567890123456789',
      },
    ])
  })
})

describe('targetEsRequest', () => {
  it('keeps the command index authoritative over a contradictory body field', () => {
    expect(
      targetEsRequest('products', {
        index: 'other',
        size: 25,
        query: { match_all: {} },
      }),
    ).toEqual({
      index: 'products',
      size: 25,
      query: { match_all: {} },
    })
  })
})

describe('shapeEsResult', () => {
  it('search hits → _id/_score + _source columns, a row per hit', () => {
    const r = shapeEsResult({
      hits: {
        total: { value: 2 },
        hits: [
          { _index: 'products-v1', _id: '1', _score: 1.2, _source: { name: 'a' } },
          {
            _index: 'products-v2',
            _id: '2',
            _score: 0.9,
            _source: { name: 'b', tags: ['x'] },
          },
        ],
      },
    })
    expect(r.columns.map((c) => c.name)).toEqual(['_id', '_index', '_score', 'name', 'tags'])
    expect(r.rows[0]).toEqual(['1', 'products-v1', 1.2, 'a', null])
    expect(r.rows[1]).toEqual(['2', 'products-v2', 0.9, 'b', '["x"]'])
  })
  it('retains requested fields when source is disabled and keeps metadata collision-free', () => {
    const r = shapeEsResult({
      hits: {
        hits: [
          {
            _index: 'logs-2026',
            _id: 'same',
            _score: 2.5,
            fields: { '@timestamp': ['2026-07-25T00:00:00Z'], _score: [99] },
          },
        ],
      },
    })
    expect(r.columns.map((c) => c.name)).toEqual([
      '_id',
      '_index',
      '_score',
      '@timestamp',
      '_fields._score',
    ])
    expect(r.rows).toEqual([['same', 'logs-2026', 2.5, '["2026-07-25T00:00:00Z"]', '[99]']])
  })
  it('preserves source fields that share names with hit metadata', () => {
    const r = shapeEsResult({
      hits: {
        hits: [
          {
            _index: 'products',
            _id: 'real-id',
            _score: 1.5,
            _source: { _id: 'source-id', _index: 'source-index', _score: 42 },
          },
        ],
      },
    })
    expect(r.columns.map((c) => c.name)).toEqual([
      '_id',
      '_index',
      '_score',
      '_source._id',
      '_source._index',
      '_source._score',
    ])
    expect(r.rows).toEqual([['real-id', 'products', 1.5, 'source-id', 'source-index', 42]])
  })
  it('keeps prototype-named source fields as ordinary result columns', () => {
    const source = parseEsCommand('products.search({"query":{"term":{"__proto__":"wanted"}}})')
      .args[0] as Record<string, unknown>
    expect(JSON.stringify(source)).toContain('"__proto__":"wanted"')

    const r = shapeEsResult({
      hits: {
        hits: [
          {
            _id: '1',
            _source: {
              ['__proto__']: { safe: true },
              constructor: 'ctor',
              prototype: 'proto',
            },
          },
        ],
      },
    })
    expect(r.columns.map((column) => column.name)).toEqual([
      '_id',
      '__proto__',
      'constructor',
      'prototype',
    ])
    expect(r.rows).toEqual([['1', '{"safe":true}', 'ctor', 'proto']])
    expect(Object.prototype).not.toHaveProperty('safe')
  })
  it('retains aggregation-only search results when size is zero', () => {
    const r = shapeEsResult({
      hits: { total: { value: 3 }, hits: [] },
      aggregations: {
        by_category: {
          buckets: [
            { key: 'books', doc_count: 2 },
            { key: 'games', doc_count: 1 },
          ],
        },
      },
    })
    expect(r.columns).toEqual([{ name: '_aggregations' }])
    expect(r.rows).toEqual([
      ['{"by_category":{"buckets":[{"key":"books","doc_count":2},{"key":"games","doc_count":1}]}}'],
    ])
  })
  it('retains one aggregation payload alongside hits without overwriting source data', () => {
    const r = shapeEsResult({
      hits: {
        hits: [
          { _id: '1', _source: { title: 'a', _aggregations: 'source value' } },
          { _id: '2', _source: { title: 'b', _aggregations: 'source value 2' } },
        ],
      },
      aggregations: { max_price: { value: 42 } },
    })
    expect(r.columns.map((c) => c.name)).toEqual([
      '_id',
      'title',
      '_aggregations',
      '_response._aggregations',
    ])
    expect(r.rows).toEqual([
      ['1', 'a', 'source value', '{"max_price":{"value":42}}'],
      ['2', 'b', 'source value 2', null],
    ])
  })
  it('retains suggestion-only searches and profiling data alongside hits', () => {
    const suggestions = shapeEsResult({
      hits: { hits: [] },
      suggest: {
        title: [{ text: 'nothng', options: [{ text: 'nothing', score: 0.9 }] }],
      },
    })
    expect(suggestions.columns).toEqual([{ name: '_suggest' }])
    expect(suggestions.rows).toEqual([
      ['{"title":[{"text":"nothng","options":[{"text":"nothing","score":0.9}]}]}'],
    ])

    const profiled = shapeEsResult({
      hits: { hits: [{ _id: '1', _source: { _profile: 'source value' } }] },
      profile: { shards: [{ id: '[node][index][0]', searches: [] }] },
    })
    expect(profiled.columns.map((column) => column.name)).toEqual([
      '_id',
      '_profile',
      '_response._profile',
    ])
    expect(profiled.rows).toEqual([
      ['1', 'source value', '{"shards":[{"id":"[node][index][0]","searches":[]}]}'],
    ])
  })
  it('surfaces partial search metadata instead of presenting partial hits as complete', () => {
    const r = shapeEsResult({
      timed_out: true,
      terminated_early: true,
      _shards: {
        total: 3,
        successful: 2,
        failed: 1,
        failures: [{ shard: 2, reason: { type: 'query_shard_exception' } }],
      },
      hits: { hits: [{ _id: '1', _source: { title: 'partial' } }] },
    })

    expect(r.columns.map((column) => column.name)).toEqual([
      '_id',
      'title',
      '_timed_out',
      '_terminated_early',
      '_shards',
    ])
    expect(r.rows).toEqual([
      [
        '1',
        'partial',
        true,
        true,
        '{"total":3,"successful":2,"failed":1,"failures":[{"shard":2,"reason":{"type":"query_shard_exception"}}]}',
      ],
    ])
  })
  it('count → a count value cell', () => {
    const r = shapeEsResult({ count: 7 })
    expect(r.columns).toEqual([{ name: 'count' }])
    expect(r.rows).toEqual([[7]])
  })
  it('get (_source) → the doc as one row', () => {
    const r = shapeEsResult({ _index: 'articles', _id: '9', _source: { title: 't' } })
    expect(r.columns.map((c) => c.name)).toEqual(['_id', '_index', 'title'])
    expect(r.rows).toEqual([['9', 'articles', 't']])
  })
})
