import { describe, expect, test } from 'bun:test'
import {
  createDatabaseAutomaticContextProvider,
  createDatabaseContextProvider,
  extractSqlTableRefs,
} from './context-provider'
import type { DbConnectionInfo } from './contracts'
import type { DbSchemas, DbTableSchema } from './drivers/port'
import type {
  AutomaticContextProvider,
  AutomaticContextRequest,
  ContextResolver,
} from '@localixai/plugin-sdk/backend'
import {
  certifyAutomaticContribution,
  certifyResolverContribution,
  sampleAutomaticRequest,
} from '../../../apps/api/src/features/context-fabric/plugin-contract-kit'

const failedChecks = (results: { check: string; ok: boolean; detail?: string }[]) =>
  results.filter((result) => !result.ok).map((result) => `${result.check}: ${result.detail ?? ''}`)

const connection: DbConnectionInfo = {
  id: 'c',
  name: 'Main',
  dialect: 'sqlite',
  connected: true,
  readonly: false,
  createdAt: 0,
  flags: {
    kind: 'sql',
    dialect: 'sqlite',
    supportsMultipleSchemas: false,
    supportsReturning: false,
    supportsCancel: false,
    defaultSchema: 'main',
  },
}
const table: DbTableSchema = {
  name: 'users',
  type: 'table',
  columns: [{ name: 'id', dataType: 'integer', nullable: false, pk: true }],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
  approxRows: 4,
}

describe('database Context Fabric provider', () => {
  const provider = createDatabaseContextProvider({
    list: async () => [connection],
    schemas: async () => ({ schemas: { main: [{ name: 'users', type: 'table' }] } as DbSchemas }),
    tableSchema: async () => ({ table }),
  }).provider as ContextResolver

  const reference = {
    version: 1 as const,
    id: 'selected',
    kind: 'resource',
    uri: 'localix://resource/db/c/_/main/users',
    freshness: 'resolve-at-send' as const,
    presentation: { label: 'users' },
    scope: { userId: 'u', sessionId: 's' },
  }
  const context = {
    destination: 'edit-prediction' as const,
    userId: 'u',
    sessionId: 's',
    maxBytes: 10000,
  }

  test('owns only db resources and produces revisioned credential-free schema context', async () => {
    expect(provider.supports(reference, 'edit-prediction')).toBe(true)
    expect(provider.supports(reference, 'chat')).toBe(true)
    expect(
      provider.supports({ ...reference, uri: 'localix://resource/docker/c' }, 'edit-prediction'),
    ).toBe(false)
    const result = await provider.resolve(reference, context, new AbortController().signal)
    expect(result).toEqual([
      expect.objectContaining({
        providerId: 'database:context',
        kind: 'database-schema',
        uri: reference.uri,
        sensitivity: 'project',
      }),
    ])
    expect(result[0]?.content).toContain('CREATE TABLE "users"')
    expect(result[0]?.content).not.toContain('password')
    expect(result[0]?.revision).toMatch(/^db-content:/)
    expect(result[0]?.priority).toBe(1_300)
  })

  test('declares chat as an explicit destination with the same immutable revision semantics', async () => {
    const contribution = createDatabaseContextProvider({
      list: async () => [connection],
      schemas: async () => ({ schemas: { main: [{ name: 'users', type: 'table' }] } as DbSchemas }),
      tableSchema: async () => ({ table }),
    })
    expect(contribution.destinations).toEqual(['edit-prediction', 'inline-completion', 'chat'])
    const resolver = contribution.provider as ContextResolver
    const chat = await resolver.resolve(
      reference,
      { ...context, destination: 'chat' },
      new AbortController().signal,
    )
    expect(chat[0]?.revision).toMatch(/^db-content:/)
    expect(chat[0]?.content).not.toContain('password')
  })
})

describe('database Context Fabric contract certification', () => {
  const service = {
    list: async () => [],
    schemas: async () => ({ schemas: {} }),
    tableSchema: async () => null,
  }

  test('the explicit resolver certifies clean', async () => {
    const contribution = createDatabaseContextProvider(service)
    const results = await certifyResolverContribution(contribution, {
      reference: {
        version: 1,
        id: 'r',
        kind: 'resource',
        uri: 'localix://resource/db/c/_/main/users',
        freshness: 'resolve-at-send',
        presentation: { label: 'users' },
        scope: { userId: 'u', sessionId: 's' },
      },
      request: { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 10_000 },
    })
    expect(failedChecks(results)).toEqual([])
  })

  test('the automatic provider certifies clean', async () => {
    const contribution = createDatabaseAutomaticContextProvider(service)
    const results = await certifyAutomaticContribution(contribution, {
      request: sampleAutomaticRequest(),
    })
    expect(failedChecks(results)).toEqual([])
  })
})

describe('extractSqlTableRefs', () => {
  test('pulls table-like identifiers after FROM/JOIN/UPDATE/INTO, schema-stripped + deduped', () => {
    const refs = extractSqlTableRefs(
      'SELECT * FROM public.users u JOIN orders o ON o.uid = u.id; UPDATE users SET x = 1; INSERT INTO logs VALUES (1)',
    )
    expect(refs.sort()).toEqual(['logs', 'orders', 'users'])
  })
  test('returns nothing for a buffer with no table references', () => {
    expect(extractSqlTableRefs('SELECT 1')).toEqual([])
  })
})

describe('database automatic Context Fabric provider', () => {
  const contribution = createDatabaseAutomaticContextProvider({
    list: async () => [connection, { ...connection, id: 'off', name: 'Cold', connected: false }],
    schemas: async () => ({
      schemas: {
        main: [
          { name: 'users', type: 'table' },
          { name: 'audit', type: 'table' },
        ],
      } as DbSchemas,
    }),
    tableSchema: async () => ({ table }),
  })
  const provider = contribution.provider as AutomaticContextProvider
  const baseReq: AutomaticContextRequest = {
    destination: 'edit-prediction',
    userId: 'u',
    sessionId: 's',
    maxBytes: 10_000,
    document: {
      uri: 'file:///q.sql',
      languageId: 'sql',
      revision: 'r1',
      content: 'SELECT * FROM users',
    },
  }

  test('registers off-by-default, prediction-only, project-sensitivity, bounded budget', () => {
    expect(contribution.activation).toBe('automatic')
    expect(contribution.defaultEnabled).toBe(false)
    expect(contribution.destinations).toEqual(['edit-prediction'])
    expect(contribution.sensitivity).toBe('project')
    expect(contribution.maxTokens).toBeLessThanOrEqual(1_500)
  })

  test('summarises referenced tables of LIVE connections without DDL or credentials', async () => {
    const result = await provider.provide(baseReq, new AbortController().signal)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      providerId: 'database:auto-context',
      kind: 'database-active-schema',
      sensitivity: 'project',
    })
    expect(result[0]?.content).toContain('users')
    expect(result[0]?.content).not.toContain('audit') // not referenced by the buffer
    expect(result[0]?.content).not.toContain('CREATE TABLE') // summary only, no DDL body
    expect(result[0]?.revision).toMatch(/^db-auto:/)
  })

  test('deterministic revision for identical input', async () => {
    const a = await provider.provide(baseReq, new AbortController().signal)
    const b = await provider.provide(baseReq, new AbortController().signal)
    expect(a[0]?.revision).toBe(b[0]?.revision)
  })

  test('emits nothing for a non-SQL document or an aborted signal', async () => {
    const nonSql = await provider.provide(
      { ...baseReq, document: { ...baseReq.document!, languageId: 'ts' } },
      new AbortController().signal,
    )
    expect(nonSql).toEqual([])
    const aborted = new AbortController()
    aborted.abort()
    expect(await provider.provide(baseReq, aborted.signal)).toEqual([])
  })
})
