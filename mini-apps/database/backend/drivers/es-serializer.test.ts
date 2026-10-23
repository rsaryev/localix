import { describe, expect, it } from 'bun:test'
import { errors } from '@elastic/elasticsearch'
import { buildEsClientOptions } from './es'
import { ExactEsSerializer, parseEsJsonExact } from './es-serializer'

describe('exact Elasticsearch JSON transport', () => {
  it('keeps long integers and high-precision decimals exact while retaining ordinary numbers', () => {
    expect(
      parseEsJsonExact('{"safe":42,"long":9223372036854775807,"decimal":1234567890.123456789}'),
    ).toEqual({
      safe: 42,
      long: '9223372036854775807',
      decimal: '1234567890.123456789',
    })
  })

  it('uses the exact serializer for every Elasticsearch client', () => {
    expect(buildEsClientOptions({ host: 'localhost' }).Serializer).toBe(ExactEsSerializer)
  })

  it('preserves prototype-named fields as inert data and wraps malformed responses', () => {
    const parsed = parseEsJsonExact(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"ok":1}',
    ) as Record<string, unknown>
    expect(Object.getPrototypeOf(parsed)).toBeNull()
    expect(parsed).toEqual({
      ['__proto__']: { polluted: true },
      constructor: { prototype: { polluted: true } },
      ok: 1,
    })
    expect(Object.prototype).not.toHaveProperty('polluted')

    const serializer = new ExactEsSerializer()
    expect(() => serializer.deserialize('{"broken":')).toThrow(errors.DeserializationError)
  })
})
