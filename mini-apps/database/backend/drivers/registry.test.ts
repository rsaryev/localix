import { describe, expect, test } from 'bun:test'
import { DATABASE_DIALECTS, DATABASE_DRIVER_CATALOG } from '../../shared/driver-catalog'
import { DATABASE_DRIVER_REGISTRY, getDriverDefinition } from './index'

describe('database driver registry', () => {
  test('has executable coverage for every shared manifest', () => {
    expect(Object.keys(DATABASE_DRIVER_REGISTRY)).toEqual([...DATABASE_DIALECTS])
    for (const dialect of DATABASE_DIALECTS) {
      const definition = getDriverDefinition(dialect)
      expect(definition.manifest).toBe(DATABASE_DRIVER_CATALOG[dialect])
    }
  })
})
