import { describe, expect, test } from 'bun:test'

import {
  connectionIdFromDatabaseUri,
  databaseTargetFromUri,
  normalizeDatabaseArea,
} from './databaseView'

describe('Database Workspace navigation', () => {
  test('accepts supported areas and safely normalizes unknown values', () => {
    expect(normalizeDatabaseArea('overview')).toBe('overview')
    expect(normalizeDatabaseArea('explorer')).toBe('explorer')
    expect(normalizeDatabaseArea('monitoring')).toBe('overview')
    expect(normalizeDatabaseArea(null)).toBe('overview')
  })

  test('extracts the connection id from connection and nested resource anchors', () => {
    expect(connectionIdFromDatabaseUri('localix://resource/db/primary')).toBe('primary')
    expect(connectionIdFromDatabaseUri('localix://resource/db/primary/_/public/users')).toBe(
      'primary',
    )
    expect(connectionIdFromDatabaseUri('localix://resource/db/team%20db/_/main')).toBe('team db')
    expect(connectionIdFromDatabaseUri('localix://resource/trade/primary')).toBeNull()
    expect(connectionIdFromDatabaseUri('localix://resource/db/')).toBeNull()
    expect(connectionIdFromDatabaseUri('localix://resource/db/%E0%A4%A')).toBeNull()
  })

  test('parses schema/table/column deep links without losing encoded names', () => {
    expect(
      databaseTargetFromUri(
        'localix://resource/db/team%20db/_/sales%20data/order%2Farchive/customer%20id',
      ),
    ).toEqual({
      connectionId: 'team db',
      schema: 'sales data',
      table: 'order/archive',
      column: 'customer id',
    })
    expect(databaseTargetFromUri('localix://resource/db/primary')).toEqual({
      connectionId: 'primary',
    })
  })
})
