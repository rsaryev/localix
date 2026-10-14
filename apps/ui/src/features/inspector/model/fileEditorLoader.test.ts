import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(import.meta.dir, path), 'utf8')

describe('file editor lazy graph', () => {
  test('warms FileTab and Monaco concurrently without restoring either to startup', () => {
    const loader = read('./fileEditorLoader.ts')
    const registry = read('../../../widgets/editor-grid/ui/registry.tsx')

    expect(loader).toContain("import('../ui/FileTab')")
    expect(loader).toContain("import('@/shared/ui/code-editor/monaco/runtimeBundle')")
    expect(loader).toContain('const attempt = Promise.all([')
    expect(registry).not.toMatch(
      /import\s+\{\s*FileTab\s*\}\s+from\s+['"]@\/features\/inspector\/ui\/FileTab['"]/,
    )
    expect(registry).toContain('loadFileEditor().then(')
  })

  test('starts the shared editor load from pointer and keyboard Explorer intent', () => {
    const entries = read('../ui/FileTreeEntries.tsx')

    expect(entries).toContain('onPointerEnter={() => void loadFileEditor()}')
    expect(entries).toContain('onFocus={() => void loadFileEditor()}')
  })

  test('warms keyboard-first file palettes as soon as they open for a session', () => {
    const palettes = [read('../ui/QuickOpen.tsx'), read('../ui/WorkspaceSymbols.tsx')]

    for (const palette of palettes) {
      expect(palette).toContain("import { loadFileEditor } from '../model/fileEditorLoader'")
      expect(palette).toContain('if (open && sessionId) void loadFileEditor()')
    }
  })
})
