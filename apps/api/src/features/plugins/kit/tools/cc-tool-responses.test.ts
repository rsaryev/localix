import { describe, expect, test } from 'bun:test'

import { claudeCodeResult } from './cc-tool-responses'

// agent-sdk/typescript.md, "Edit" and "Write" output: `structuredPatch` is the diff's hunks, read by
// the kit's `structuredPatchOf`.
const diff = [
  '--- a/notes.md',
  '+++ b/notes.md',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old',
  '+new',
  '\\ No newline at end of file',
].join('\n')

describe("a file tool's result in Claude Code's shape", () => {
  test("an Edit carries the kit's hunks of the tool's diff", () => {
    const result = claudeCodeResult(
      'Edit',
      { content: 'ok', details: { cwd: '/w', files: [{ path: 'notes.md', diff }] } },
      { edits: [{ old_string: 'old', new_string: 'new' }] },
    )
    expect(result).toEqual({
      filePath: '/w/notes.md',
      oldString: 'old',
      newString: 'new',
      originalFile: null,
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          lines: [' keep', '-old', '+new', '\\ No newline at end of file'],
        },
      ],
      userModified: false,
      replaceAll: false,
    })
  })

  test('a Write with no diff has no hunks', () => {
    const result = claudeCodeResult(
      'Write',
      { content: 'ok', details: { cwd: '/w', files: [{ path: 'a.md', created: true }] } },
      { files: [{ path: 'a.md', content: 'hi' }] },
    )
    expect(result).toMatchObject({ type: 'create', filePath: '/w/a.md', structuredPatch: [] })
  })
})
