import { describe, expect, test } from 'bun:test'
import { buildStagedCliPackageMetadata } from './cli-package-metadata.mjs'

describe('staged desktop CLI metadata', () => {
  test('uses the authoritative Tauri bundle version', () => {
    expect(buildStagedCliPackageMetadata({ version: '1.2.3' })).toEqual({
      name: 'localix-desktop-cli',
      private: true,
      version: '1.2.3',
      type: 'module',
    })
  })

  test('rejects missing or invalid versions', () => {
    expect(() => buildStagedCliPackageMetadata({})).toThrow('semantic version')
    expect(() => buildStagedCliPackageMetadata({ version: 'dev' })).toThrow('semantic version')
  })
})
