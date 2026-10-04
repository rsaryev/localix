import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLspDocumentService, type LspServiceDeps } from './service'
import type { LspCodeAction } from './lsp-client'
import { applyTextEdits, textDigest } from './lsp-edits'

/**
 * An edit to a document an editor holds open belongs to that editor's buffer.
 *
 * The regression: the person types (buffer dirty, not saved), a squiggle appears, they
 * pick the quick fix. The server spliced the fix's ranges — computed against the BUFFER —
 * into the file ON DISK, and the editor then raised "changed on disk" over the fix it had
 * just asked for. These cases pin the new rule from both sides: an open buffer gets edits
 * fingerprinted by its exact text and disk is untouched; a closed file still commits.
 */

const renameXtoY = (file: string): LspCodeAction => ({
  title: 'Rename x → y',
  kind: 'quickfix',
  edit: [
    {
      file,
      edits: [
        {
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
          newText: 'y',
        },
      ],
    },
  ],
})

function makeService(formatEdits: LspCodeAction['edit'] = []) {
  const writes: { file: string; content: string }[] = []
  const deps: LspServiceDeps = {
    lspManager: {
      openDocument: async () => {},
      changeDocument: async () => {},
      closeDocument: async () => {},
      resolveCodeAction: async () => null,
      formatDocument: async () => formatEdits?.[0]?.edits ?? [],
      getFileDiagnostics: () => [],
      onUpdate: () => () => {},
    } as unknown as LspServiceDeps['lspManager'],
    resolveProjectRoot: async () => '/root',
    publish: () => {},
    writeFile: async (_u, _s, file, content) => {
      writes.push({ file, content })
      return { hash: 'h' }
    },
  }
  return { svc: createLspDocumentService(deps), writes }
}

describe('LSP edits route to the open buffer, not to disk', () => {
  test('a quick fix on an open, unsaved buffer comes back as a buffer edit and writes nothing', async () => {
    const target = join(tmpdir(), `lsp-route-open-${Date.now()}.ts`)
    // Disk still holds the OLD text; the editor's buffer has moved on.
    await Bun.write(target, '// saved long ago\n')
    const { svc, writes } = makeService()
    const unsaved = 'const x = 1\n'
    await svc.open('alice', 'sess-1', target, unsaved)

    const result = await svc.applyCodeAction('alice', 'sess-1', target, renameXtoY(target))

    expect(writes).toEqual([])
    expect(result.changedFiles).toEqual([])
    expect(result.bufferEdits).toHaveLength(1)
    const [edit] = result.bufferEdits!
    expect(edit.file).toBe(target)
    // Fingerprinted by the text the server holds — the unsaved buffer, not disk.
    expect(edit.digest).toBe(textDigest(unsaved))
    expect(applyTextEdits(unsaved, edit.edits)).toBe('const y = 1\n')
  })

  test('the buffer text is the LATEST change, not the text the document was opened with', async () => {
    const target = join(tmpdir(), `lsp-route-changed-${Date.now()}.ts`)
    const { svc } = makeService()
    await svc.open('alice', 'sess-1', target, 'const q = 0\n')
    await svc.change('alice', 'sess-1', target, 'const x = 1\n')

    const result = await svc.applyCodeAction('alice', 'sess-1', target, renameXtoY(target))

    expect(result.bufferEdits?.[0]?.digest).toBe(textDigest('const x = 1\n'))
  })

  test('a file no editor holds open is still committed to disk', async () => {
    const target = join(tmpdir(), `lsp-route-closed-${Date.now()}.ts`)
    await Bun.write(target, 'const x = 1\n')
    const { svc, writes } = makeService()

    const result = await svc.applyCodeAction('alice', 'sess-1', target, renameXtoY(target))

    expect(writes).toEqual([{ file: target, content: 'const y = 1\n' }])
    expect(result.changedFiles).toEqual([target])
    expect(result.bufferEdits).toBeUndefined()
  })

  test("another user's open document is not this user's buffer", async () => {
    const target = join(tmpdir(), `lsp-route-owner-${Date.now()}.ts`)
    await Bun.write(target, 'const x = 1\n')
    const { svc, writes } = makeService()
    await svc.open('mallory', 'sess-1', target, 'const x = 1\n')

    const result = await svc.applyCodeAction('alice', 'sess-1', target, renameXtoY(target))

    expect(result.bufferEdits).toBeUndefined()
    expect(writes).toHaveLength(1)
  })

  test('an edit that would not change the buffer is dropped, not returned', async () => {
    const target = join(tmpdir(), `lsp-route-noop-${Date.now()}.ts`)
    const { svc } = makeService()
    await svc.open('alice', 'sess-1', target, 'const y = 1\n')
    const noop: LspCodeAction = {
      title: 'Noop',
      edit: [
        {
          file: target,
          edits: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
              newText: 'y',
            },
          ],
        },
      ],
    }

    const result = await svc.applyCodeAction('alice', 'sess-1', target, noop)

    expect(result).toEqual({ changedFiles: [], files: [] })
  })

  test("openBufferText is the user's own latest buffer — never another user's, gone once closed", async () => {
    const { svc } = makeService()
    await svc.open('alice', 'sess-1', '/w/a.ts', 'opened')
    await svc.change('alice', 'sess-1', '/w/a.ts', 'typed, unsaved')
    await svc.open('mallory', 'sess-9', '/w/b.ts', 'secret')

    expect(svc.openBufferText('alice', '/w/a.ts')).toBe('typed, unsaved')
    expect(svc.openBufferText('alice', '/w/b.ts')).toBeUndefined()
    await svc.close('alice', 'sess-1', '/w/a.ts')
    expect(svc.openBufferText('alice', '/w/a.ts')).toBeUndefined()
  })

  test('format returns buffer edits for an open document and null for a closed one', async () => {
    const target = join(tmpdir(), `lsp-route-format-${Date.now()}.ts`)
    const { svc, writes } = makeService([
      {
        file: target,
        edits: [
          {
            range: { start: { line: 0, character: 9 }, end: { line: 0, character: 9 } },
            newText: ';',
          },
        ],
      },
    ])
    const options = { tabSize: 2, insertSpaces: true }
    expect(await svc.formatDocument('alice', 'sess-1', target, options)).toBeNull()

    await svc.open('alice', 'sess-1', target, 'const a=1\n')
    const edit = await svc.formatDocument('alice', 'sess-1', target, options)

    expect(writes).toEqual([])
    expect(edit?.digest).toBe(textDigest('const a=1\n'))
    expect(applyTextEdits('const a=1\n', edit!.edits)).toBe('const a=1;\n')
  })
})
