import { describe, expect, it } from 'bun:test'

import {
  groupForeignKeyRows,
  normalizeForeignKeyMatch,
  normalizeReferentialAction,
} from './fk-rows'

describe('foreign-key catalog normalization', () => {
  it('normalizes PostgreSQL chars and SQL Server action spellings', () => {
    expect(['a', 'r', 'c', 'n', 'd'].map(normalizeReferentialAction)).toEqual([
      'NO ACTION',
      'RESTRICT',
      'CASCADE',
      'SET NULL',
      'SET DEFAULT',
    ])
    expect(normalizeReferentialAction('NO_ACTION')).toBe('NO ACTION')
    expect(normalizeForeignKeyMatch('f')).toBe('FULL')
    expect(normalizeForeignKeyMatch('SIMPLE')).toBe('SIMPLE')
  })

  it('groups composite keys without dropping constraint semantics', () => {
    expect(
      groupForeignKeyRows([
        {
          id: 'fk_order_tenant',
          column: 'tenant_id',
          refSchema: 'core',
          refTable: 'tenants',
          refColumn: 'id',
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
          match: 'FULL',
          deferrable: true,
          initiallyDeferred: true,
          validated: false,
          onDeleteColumns: ['tenant_id'],
          period: true,
          enforced: false,
        },
        {
          id: 'fk_order_tenant',
          column: 'tenant_region',
          refSchema: 'core',
          refTable: 'tenants',
          refColumn: 'region',
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
          match: 'FULL',
          deferrable: true,
          initiallyDeferred: true,
          validated: false,
          onDeleteColumns: ['tenant_id'],
          period: true,
          enforced: false,
        },
      ]),
    ).toEqual([
      {
        name: 'fk_order_tenant',
        columns: ['tenant_id', 'tenant_region'],
        refSchema: 'core',
        refTable: 'tenants',
        refColumns: ['id', 'region'],
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        match: 'FULL',
        deferrable: true,
        initiallyDeferred: true,
        validated: false,
        onDeleteColumns: ['tenant_id'],
        period: true,
        enforced: false,
      },
    ])
  })
})
