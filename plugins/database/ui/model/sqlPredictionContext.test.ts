import { describe, expect, it } from 'bun:test'
import type { DbSchemas } from '../dbClient'
import { sqlPredictionContextReferences } from './sqlPredictionContext'

const schemas = {
  public: [
    { name: 'users', type: 'table' },
    { name: 'orders', type: 'table' },
  ],
  audit: [{ name: 'events', type: 'table' }],
} as DbSchemas

function request(content: string, cursorLine = 1, cursorColumn = content.length) {
  return {
    content,
    cursorLine,
    cursorColumn,
    documentVersion: 1,
    documentDigest: 'digest',
    requestId: 'request',
  }
}

describe('sqlPredictionContextReferences', () => {
  it('adds exact table resources from the focused statement after the connection root', () => {
    const refs = sqlPredictionContextReferences({
      connectionId: 'c1',
      connectionLabel: 'App DB',
      schemas,
      request: request('SELECT u.id FROM public.users u JOIN orders o ON o.user_id = u.id'),
    })

    expect(refs.map((ref) => ref.uri)).toEqual([
      'localix://resource/db/c1',
      'localix://resource/db/c1/_/public/users',
      'localix://resource/db/c1/_/public/orders',
    ])
  })

  it('does not leak tables from a neighbouring statement into focused-table DDL', () => {
    const content = 'SELECT * FROM users;\nSELECT * FROM audit.events'
    const refs = sqlPredictionContextReferences({
      connectionId: 'c1',
      connectionLabel: 'App DB',
      schemas,
      request: request(content, 2, 'SELECT * FROM audit.events'.length),
    })

    expect(refs.map((ref) => ref.uri)).toEqual([
      'localix://resource/db/c1',
      'localix://resource/db/c1/_/audit/events',
    ])
  })

  it('keeps root context for an unfinished statement with no resolvable table yet', () => {
    const refs = sqlPredictionContextReferences({
      connectionId: 'c1',
      connectionLabel: 'App DB',
      schemas,
      request: request('SELECT * FROM '),
    })
    expect(refs.map((ref) => ref.uri)).toEqual(['localix://resource/db/c1'])
  })
})
