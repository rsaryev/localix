import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC_ROOT = resolve(import.meta.dir, '../../..')
const IMPORTS_SONNER = /from\s+['"]sonner['"]/

const sonnerImporters = () =>
  [...new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: SRC_ROOT })].filter((path) =>
    IMPORTS_SONNER.test(readFileSync(resolve(SRC_ROOT, path), 'utf8')),
  )

describe('event center import boundary', () => {
  it('has no transient Sonner surface or direct Sonner publisher', () => {
    expect(sonnerImporters()).toEqual([])
  })

  it('does not mount a toaster at the application root', () => {
    const root = readFileSync(resolve(SRC_ROOT, 'app/RootLayout.tsx'), 'utf8')
    expect(root).not.toContain('Toaster')
  })
})
