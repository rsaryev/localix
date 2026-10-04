import { describe, expect, test } from 'bun:test'
import type { ExecutionEnvironment } from './tools/environment'
import {
  loadProjectStructureSnapshot,
  PROJECT_STRUCTURE_MAX_CHARS,
  PROJECT_STRUCTURE_MAX_LINES,
  renderProjectStructure,
} from './project-structure'

describe('project structure prompt snapshot', () => {
  test('renders a deterministic shallow names-only tree', () => {
    expect(
      renderProjectStructure([
        'styles.css',
        'apps/ui/src/App.tsx',
        'apps/api/src/index.ts',
        'README.md',
        'apps/ui/package.json',
      ]),
    ).toBe(
      ['apps/', '  api/', '    … 1 file', '  ui/', '    … 2 files', 'README.md', 'styles.css'].join(
        '\n',
      ),
    )
  })

  test('sanitizes control characters, rejects traversal and enforces both budgets', () => {
    expect(renderProjectStructure(['../secret', 'safe/```line\nbreak.ts'])).toBe(
      ['safe/', '  ˋˋˋline�break.ts'].join('\n'),
    )
    const paths = Array.from({ length: 200 }, (_, index) => `folder-${index}/file-${index}.ts`)
    const rendered = renderProjectStructure(paths)!
    expect(rendered).not.toContain('secret')
    expect(rendered.split('\n').length).toBeLessThanOrEqual(PROJECT_STRUCTURE_MAX_LINES)
    expect(rendered.length).toBeLessThanOrEqual(PROJECT_STRUCTURE_MAX_CHARS)
    expect(rendered).toEndWith('… more entries omitted')
  })

  test('discovery is best-effort and does not block a run', async () => {
    const env = {
      exec: async () => {
        throw new Error('remote unavailable')
      },
    } as unknown as ExecutionEnvironment
    expect(await loadProjectStructureSnapshot(env, '/workspace')).toBeUndefined()
  })
})
