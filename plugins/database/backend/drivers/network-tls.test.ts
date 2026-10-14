import { describe, expect, test } from 'bun:test'

import { buildEsClientOptions } from './es'
import { buildMongoClientOptions } from './mongo'
import { buildPostgresOptions } from './postgres'
import { buildRedisClientOptions } from './redis'

const advancedTls = {
  rejectUnauthorized: false,
  ca: 'CA PEM',
  cert: 'CERT PEM',
  key: 'KEY PEM',
} as const

describe('network driver TLS options', () => {
  test('PostgreSQL keeps TLS overrides beside a URL', () => {
    expect(
      buildPostgresOptions({
        url: 'postgres://reader:secret@postgres.example/app',
        ssl: advancedTls,
      }),
    ).toMatchObject({ ssl: advancedTls })
  })

  test('Elasticsearch keeps TLS overrides beside a URL', () => {
    expect(
      buildEsClientOptions({
        url: 'https://elastic.example:9243',
        ssl: advancedTls,
      }),
    ).toMatchObject({
      node: 'https://elastic.example:9243',
      tls: advancedTls,
    })
  })

  test('MongoDB passes PEM text through Node-native TLS socket options', () => {
    expect(
      buildMongoClientOptions({
        url: 'mongodb://mongo.example/app',
        ssl: advancedTls,
      }),
    ).toMatchObject({
      tls: true,
      useBigInt64: true,
      ...advancedTls,
    })
  })

  test('Redis forwards both boolean and advanced TLS beside a URL', () => {
    expect(
      buildRedisClientOptions({
        url: 'rediss://redis.example',
        ssl: true,
      }),
    ).toMatchObject({ tls: true })
    expect(
      buildRedisClientOptions({
        url: 'rediss://redis.example',
        ssl: advancedTls,
      }),
    ).toMatchObject({ tls: advancedTls })
  })
})
