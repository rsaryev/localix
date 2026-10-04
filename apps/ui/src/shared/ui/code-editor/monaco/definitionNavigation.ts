import type * as Monaco from 'monaco-editor'
import type { DefinitionSource, DefinitionTargetSource } from '../types'
import type { MonacoApi } from './runtime'

export interface DefinitionNavigationSources {
  filePath?: string
  definitionSource?: DefinitionSource
  definitionTargetSource?: DefinitionTargetSource
  onLocationNavigate?: (location: { file: string; line: number; column?: number }) => void
}

/** Native definition provider + cross-model opener for one editor instance. */
export function registerDefinitionNavigation(options: {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  language: string
  getSources: () => DefinitionNavigationSources
  resolveDefinitionUri?: (file: string, source?: DefinitionTargetSource) => Promise<Monaco.Uri>
}): Monaco.IDisposable {
  const { monaco, editor, model, language, getSources, resolveDefinitionUri } = options
  const provider = monaco.languages.registerDefinitionProvider(language, {
    async provideDefinition(candidate, position, token) {
      const source = getSources().definitionSource
      if (!source || candidate !== model) return null
      const locations = await source({
        line: position.lineNumber - 1,
        character: position.column - 1,
      })
      if (token.isCancellationRequested || candidate !== model || !locations.length) return null
      const currentPath = getSources().filePath
      const definitions = await Promise.all(
        locations.map(async (location) => {
          const lineNumber = Math.max(location.line + 1, 1)
          const column = Math.max((location.character ?? 0) + 1, 1)
          const uri =
            currentPath === location.file
              ? model.uri
              : resolveDefinitionUri
                ? await resolveDefinitionUri(location.file, getSources().definitionTargetSource)
                : monaco.Uri.file(location.file)
          return {
            uri,
            range: new monaco.Range(lineNumber, column, lineNumber, column),
          }
        }),
      )
      return token.isCancellationRequested || candidate !== model ? null : definitions
    },
  })
  const opener = monaco.editor.registerEditorOpener({
    openCodeEditor(sourceEditor, resource, selectionOrPosition) {
      if (sourceEditor !== editor) return false
      const navigate = getSources().onLocationNavigate
      if (!navigate) return false
      const selection = selectionOrPosition
      const lineNumber = selection
        ? 'startLineNumber' in selection
          ? selection.startLineNumber
          : selection.lineNumber
        : 1
      const column = selection
        ? 'startColumn' in selection
          ? selection.startColumn
          : selection.column
        : 1
      navigate({
        file: resource.fsPath,
        line: Math.max(lineNumber - 1, 0),
        column: Math.max(column - 1, 0),
      })
      return true
    },
  })

  return {
    dispose() {
      provider.dispose()
      opener.dispose()
    },
  }
}
