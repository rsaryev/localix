import { describe, expect, test } from 'bun:test'
import { budgetFiles, measureBudget } from './code-budget.mjs'

const config = {
  limit: 10,
  exclude: ['**/vendor/**', '**/generated/**', '**/testing/**'],
}

describe('budgetFiles', () => {
  test('counts product code in every language, never tests, helpers, vendored or generated code', () => {
    const files = [
      'apps/api/src/a.ts',
      'apps/api/src/a.test.ts',
      'apps/ui/src/B.tsx',
      'apps/ui/src/B.dom.test.tsx',
      'apps/ui/src/testing/render.tsx',
      'apps/desktop-tauri/src-tauri/src/main.rs',
      'packages/kit/styles/chrome.css',
      'scripts/coverage.mjs',
      'scripts/build-stamp.d.mts',
      'scripts/screenshots/capture.pw.mjs',
      'vendor/monaco/editor.js',
      'apps/landing/src/generated/docs.ts',
      'docs/guide.md',
    ]
    expect(budgetFiles(files, config.exclude)).toEqual([
      'apps/api/src/a.ts',
      'apps/ui/src/B.tsx',
      'apps/desktop-tauri/src-tauri/src/main.rs',
      'packages/kit/styles/chrome.css',
      'scripts/coverage.mjs',
    ])
  })
})

describe('measureBudget', () => {
  const read = (file: string) =>
    ({
      'apps/api/src/a.ts': 'export const a = 1\n// note\nexport const b = 2\n',
      'apps/ui/src/B.tsx': 'export const B = () => <div />\n',
      'plugins/chess/backend/c.ts': 'export const c = 1\n',
    })[file] ?? ''

  test('within the limit it passes and says how much room is left', () => {
    const result = measureBudget(['apps/api/src/a.ts', 'apps/ui/src/B.tsx'], read, 10)
    expect(result).toMatchObject({ total: 3, limit: 10, ok: true })
    expect(result.areas).toEqual([
      { area: 'apps/api', lines: 2 },
      { area: 'apps/ui', lines: 1 },
    ])
  })

  test('over the limit it fails and names the overrun', () => {
    const result = measureBudget(
      ['apps/api/src/a.ts', 'apps/ui/src/B.tsx', 'plugins/chess/backend/c.ts'],
      read,
      3,
    )
    expect(result).toMatchObject({ total: 4, limit: 3, over: 1, ok: false })
  })
})
