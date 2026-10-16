import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectFileIndex } from './project-file-index'
import { LocalEnvironment } from './tools/environments/local'

// The index used to split `rg --files` on '\n' and trim each line, so a file named
// ` lead.ts` or `trail.ts ` came back as a path that does not exist, and a name with an
// embedded newline came back as two. A real ripgrep run proves the NUL-split keeps them.
describe.skipIf(!Bun.which('rg'))('loadProjectFileIndex', () => {
  test('keeps names with edge whitespace and embedded newlines intact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'project-file-index-'))
    try {
      mkdirSync(join(root, 'src'))
      for (const name of [' lead.ts', 'trail.ts ', 'two\nlines.ts', 'plain.ts']) {
        writeFileSync(join(root, 'src', name), '')
      }
      // At the root the leading space is the start of the listed line, so trim ate it too.
      writeFileSync(join(root, ' root-lead.ts'), '')
      const index = await loadProjectFileIndex(new LocalEnvironment(), root)
      expect(index.omitted).toBe(0)
      expect([...index.paths].sort()).toEqual(
        [
          ' root-lead.ts',
          'src/ lead.ts',
          'src/plain.ts',
          'src/trail.ts ',
          'src/two\nlines.ts',
        ].sort(),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
