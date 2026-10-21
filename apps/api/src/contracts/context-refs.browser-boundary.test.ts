import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONTEXT_REFS_SOURCE = resolve(import.meta.dir, 'context-refs.ts')
const SDK_PACKAGE_JSON = resolve(import.meta.dir, '../../../../packages/plugin-sdk/package.json')

describe('context refs browser boundary', () => {
  it('imports pure resource navigation without evaluating the Node backend barrel', () => {
    const source = readFileSync(CONTEXT_REFS_SOURCE, 'utf8')
    const manifest = JSON.parse(readFileSync(SDK_PACKAGE_JSON, 'utf8')) as {
      exports?: Record<string, { import?: string; types?: string }>
    }

    expect(source).toContain("from '@localixai/plugin-sdk/resource-refs'")
    expect(source).not.toContain("from '@localixai/plugin-sdk/backend'")
    expect(manifest.exports?.['./resource-refs']).toEqual({
      types: './dist/backend/resource-refs.d.ts',
      import: './dist/backend/resource-refs.js',
    })
  })
})
