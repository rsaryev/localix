import { describe, expect, test } from 'bun:test'
import {
  DATABASE_DIALECTS,
  DATABASE_DRIVERS,
  DATABASE_DRIVER_CATALOG,
  getDatabaseDriverManifest,
} from './driver-catalog'

describe('database driver catalog', () => {
  test('has one ordered, self-identifying manifest per dialect', () => {
    expect(DATABASE_DRIVERS.map((driver) => driver.id)).toEqual([...DATABASE_DIALECTS])
    expect(new Set(DATABASE_DRIVERS.map((driver) => driver.id)).size).toBe(DATABASE_DIALECTS.length)
    for (const dialect of DATABASE_DIALECTS) {
      expect(DATABASE_DRIVER_CATALOG[dialect].id).toBe(dialect)
      expect(getDatabaseDriverManifest(dialect)).toBe(DATABASE_DRIVER_CATALOG[dialect])
    }
  })

  test('network capability declarations stay internally consistent', () => {
    for (const driver of DATABASE_DRIVERS) {
      if (driver.transport === 'file') {
        expect(driver.defaultPort).toBeUndefined()
        expect(driver.defaultTlsPort).toBeUndefined()
        expect(driver.capabilities.sshTunnel).toBe(false)
        expect(driver.capabilities.tls).toBe(false)
      } else {
        expect(driver.defaultPort).toBeGreaterThan(0)
        if (driver.defaultTlsPort !== undefined) {
          expect(driver.capabilities.tls).toBe(true)
          expect(driver.defaultTlsPort).toBeGreaterThan(0)
        }
        expect(driver.urlSchemes.length).toBeGreaterThan(0)
      }
      if (driver.kind !== 'sql') {
        expect(driver.capabilities.manualTransactions).toBe(false)
        expect(driver.capabilities.rowEditing).toBe(false)
        expect(driver.capabilities.explain).toBe(false)
      }
    }
  })

  test('the non-SQL engines share one network-only, browse-only capability set', () => {
    for (const dialect of ['redis', 'mongodb', 'elasticsearch'] as const) {
      expect(DATABASE_DRIVER_CATALOG[dialect].capabilities).toEqual({
        multipleSchemas: false,
        returning: false,
        queryCancel: false,
        manualTransactions: false,
        sshTunnel: true,
        tls: true,
        dataBrowser: true,
        rowEditing: false,
        explain: false,
        relationships: false,
        schemaEditing: false,
      })
    }
  })

  test('schema editors get driver-owned types and unique DEFAULT expressions', () => {
    for (const driver of DATABASE_DRIVERS) {
      const values = driver.schemaDefaultExpressions.map((expression) => expression.value)
      expect(new Set(values).size).toBe(values.length)
      if (driver.capabilities.schemaEditing) {
        expect(driver.schemaDataTypes.length).toBeGreaterThan(0)
        expect(values.length).toBeGreaterThan(0)
      }
      if (driver.kind !== 'sql') expect(values).toEqual([])
    }
  })

  test('SQL drivers declare one scalable parameter-binding contract', () => {
    for (const driver of DATABASE_DRIVERS) {
      const parameters = driver.queryParameters
      expect(new Set(parameters.syntaxes).size).toBe(parameters.syntaxes.length)
      if (driver.kind === 'sql') {
        expect(parameters.syntaxes).toContain('question')
        expect(parameters.syntaxes).toContain('named-colon')
        expect(parameters.bindStyle).not.toBeNull()
      } else {
        expect(parameters).toEqual({ syntaxes: [], bindStyle: null })
      }
    }
    expect(DATABASE_DRIVER_CATALOG.postgres.queryParameters.bindStyle).toBe('numbered-dollar')
    expect(DATABASE_DRIVER_CATALOG.mssql.queryParameters.syntaxes).toContain('named-at')
    expect(DATABASE_DRIVER_CATALOG.sqlite.queryParameters.syntaxes).toContain('named-dollar')
  })
})
