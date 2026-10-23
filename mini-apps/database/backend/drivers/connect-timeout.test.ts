import { describe, expect, test } from 'bun:test'
import { CONNECT_TIMEOUT_MS } from './connect-timeout'
import { buildMongoClientOptions } from './mongo'
import { buildMssqlPoolConfig } from './mssql-config'
import { buildMysqlPoolOptions } from './mysql'
import { buildPostgresOptions } from './postgres'
import { buildRedisClientOptions } from './redis'

describe('one connect timeout for every network engine', () => {
  const fields = { host: 'db.internal', port: 1 }

  test('each client is given the same bound', () => {
    expect(buildPostgresOptions(fields).connect_timeout).toBe(CONNECT_TIMEOUT_MS / 1000)
    expect(buildMysqlPoolOptions(fields).connectTimeout).toBe(CONNECT_TIMEOUT_MS)
    expect(buildRedisClientOptions(fields).connectionTimeout).toBe(CONNECT_TIMEOUT_MS)
    expect(buildMongoClientOptions(fields).serverSelectionTimeoutMS).toBe(CONNECT_TIMEOUT_MS)
    const mssql = buildMssqlPoolConfig(fields)
    expect(typeof mssql === 'object' && mssql.connectionTimeout).toBe(CONNECT_TIMEOUT_MS)
    const mssqlUri = buildMssqlPoolConfig({ url: 'sqlserver://sa@db.internal:1433/app' })
    expect(typeof mssqlUri === 'object' && mssqlUri.connectionTimeout).toBe(CONNECT_TIMEOUT_MS)
  })

  test('a pasted ADO connection string keeps its own timeout', () => {
    const ado = 'Server=db;Connect Timeout=60'
    expect(buildMssqlPoolConfig({ url: ado })).toBe(ado)
  })
})
