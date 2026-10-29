import { describe, expect, test } from 'bun:test'

import { tempDirPerTest } from '@localixai/testing'

import { readContract } from './mini-app-contract.mjs'

const kit = (declaration: string) =>
  tempDirPerTest('mini-app-contract', {
    'kit.json': JSON.stringify({
      apiVersion: 1,
      typePaths: { '@localixai/mini-app-sdk/backend': 'types/backend.d.ts' },
      authoring: { typeRoots: 'types', backendSharedModules: [] },
      uiSharedExports: {},
    }),
    'types/backend.d.ts': declaration,
  })

describe('the contract of a staged kit', () => {
  const complete = kit('export declare function isPathWithin(root: string, path: string): boolean;')
  test('declares each export as the kit declares it', () => {
    expect(readContract(complete()).modules['@localixai/mini-app-sdk/backend']).toEqual({
      isPathWithin: 'export declare function isPathWithin(root: string, path: string): boolean;',
    })
  })

  // A mini app's editor and type-check see exactly the kit: an export whose declarations the kit
  // left out is `any` there, without a word, so the kit must not be published that way.
  const incomplete = kit("export { isPathWithin } from '@localixai/path-containment';")
  test('refuses an export whose declarations the kit leaves out', () => {
    expect(() => readContract(incomplete())).toThrow(
      '@localixai/mini-app-sdk/backend: isPathWithin',
    )
  })
})
