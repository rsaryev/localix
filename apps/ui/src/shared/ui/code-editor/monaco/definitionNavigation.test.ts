import { describe, expect, test } from 'bun:test'
import type * as Monaco from 'monaco-editor'
import { registerDefinitionNavigation } from './definitionNavigation'
import type { MonacoApi } from './runtime'

function harness() {
  let provider: Monaco.languages.DefinitionProvider | undefined
  let opener: Monaco.editor.ICodeEditorOpener | undefined
  const disposed: string[] = []
  class Range {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number

    constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    ) {
      this.startLineNumber = startLineNumber
      this.startColumn = startColumn
      this.endLineNumber = endLineNumber
      this.endColumn = endColumn
    }
  }
  const uri = (file: string) => ({ fsPath: file, toString: () => `file://${file}` }) as Monaco.Uri
  const monaco = {
    Range,
    Uri: { file: uri },
    languages: {
      registerDefinitionProvider: (
        _language: string,
        value: Monaco.languages.DefinitionProvider,
      ) => {
        provider = value
        return { dispose: () => disposed.push('provider') }
      },
    },
    editor: {
      registerEditorOpener: (value: Monaco.editor.ICodeEditorOpener) => {
        opener = value
        return { dispose: () => disposed.push('opener') }
      },
    },
  } as unknown as MonacoApi
  const editor = {} as Monaco.editor.IStandaloneCodeEditor
  const model = { uri: uri('/work/current.ts') } as Monaco.editor.ITextModel
  return {
    monaco,
    editor,
    model,
    uri,
    provider: () => provider!,
    opener: () => opener!,
    disposed,
  }
}

describe('definition navigation adapter', () => {
  test('keeps every target, reuses the current model, and resolves cross-file models', async () => {
    const h = harness()
    const resolved: string[] = []
    const registration = registerDefinitionNavigation({
      monaco: h.monaco,
      editor: h.editor,
      model: h.model,
      language: 'typescript',
      getSources: () => ({
        filePath: '/work/current.ts',
        definitionSource: async () => [
          { file: '/work/current.ts', line: 2, character: 3 },
          { file: '/work/target.ts', line: 8, character: 5 },
        ],
      }),
      resolveDefinitionUri: async (file) => {
        resolved.push(file)
        return h.uri(file)
      },
    })

    const definitions = (await h.provider().provideDefinition(
      h.model,
      { lineNumber: 4, column: 7 } as Monaco.Position,
      {
        isCancellationRequested: false,
      } as Monaco.CancellationToken,
    )) as Monaco.languages.Location[]

    expect(definitions).toHaveLength(2)
    expect(definitions[0]!.uri).toBe(h.model.uri)
    expect(definitions[0]!.range).toEqual({
      startLineNumber: 3,
      startColumn: 4,
      endLineNumber: 3,
      endColumn: 4,
    })
    expect(definitions[1]!.uri.fsPath).toBe('/work/target.ts')
    expect(resolved).toEqual(['/work/target.ts'])
    registration.dispose()
    expect(h.disposed).toEqual(['provider', 'opener'])
  })

  test('drops a stale result when Monaco cancels while its target resolves', async () => {
    const h = harness()
    const token = { isCancellationRequested: false }
    registerDefinitionNavigation({
      monaco: h.monaco,
      editor: h.editor,
      model: h.model,
      language: 'typescript',
      getSources: () => ({
        definitionSource: async () => [{ file: '/work/target.ts', line: 1 }],
      }),
      resolveDefinitionUri: async (file) => {
        token.isCancellationRequested = true
        return h.uri(file)
      },
    })

    expect(
      await h
        .provider()
        .provideDefinition(
          h.model,
          { lineNumber: 1, column: 1 } as Monaco.Position,
          token as Monaco.CancellationToken,
        ),
    ).toBeNull()
  })

  test('routes only this editor and preserves the target column', () => {
    const h = harness()
    const navigations: unknown[] = []
    registerDefinitionNavigation({
      monaco: h.monaco,
      editor: h.editor,
      model: h.model,
      language: 'typescript',
      getSources: () => ({ onLocationNavigate: (location) => navigations.push(location) }),
    })

    expect(
      h.opener().openCodeEditor({} as Monaco.editor.ICodeEditor, h.uri('/work/other.ts'), {
        lineNumber: 6,
        column: 9,
      }),
    ).toBe(false)
    expect(
      h.opener().openCodeEditor(h.editor, h.uri('/work/target.ts'), {
        startLineNumber: 6,
        startColumn: 9,
        endLineNumber: 6,
        endColumn: 12,
      }),
    ).toBe(true)
    expect(navigations).toEqual([{ file: '/work/target.ts', line: 5, column: 8 }])
  })
})
