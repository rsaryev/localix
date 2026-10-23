import { describe, expect, test } from 'bun:test'

import { databaseTargetFromUri, normalizeDatabaseArea } from './databaseView'

describe('Database Workspace navigation', () => {
  test('accepts supported areas and safely normalizes unknown values', () => {
    expect(normalizeDatabaseArea('overview')).toBe('overview')
    expect(normalizeDatabaseArea('explorer')).toBe('explorer')
    expect(normalizeDatabaseArea('monitoring')).toBe('overview')
    expect(normalizeDatabaseArea(null)).toBe('overview')
  })

  test('extracts the connection id from connection and nested resource anchors', () => {
    expect(databaseTargetFromUri('localix://resource/db/primary')?.connectionId ?? null).toBe(
      'primary',
    )
    expect(
      databaseTargetFromUri('localix://resource/db/primary/_/public/users')?.connectionId ?? null,
    ).toBe('primary')
    expect(
      databaseTargetFromUri('localix://resource/db/team%20db/_/main')?.connectionId ?? null,
    ).toBe('team db')
    expect(
      databaseTargetFromUri('localix://resource/trade/primary')?.connectionId ?? null,
    ).toBeNull()
    expect(databaseTargetFromUri('localix://resource/db/')?.connectionId ?? null).toBeNull()
    expect(databaseTargetFromUri('localix://resource/db/%E0%A4%A')?.connectionId ?? null).toBeNull()
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
