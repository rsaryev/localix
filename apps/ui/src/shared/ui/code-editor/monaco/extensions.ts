import type * as Monaco from 'monaco-editor'
import type { MonacoApi } from './runtime'

export interface MonacoEditorExtensionContext {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
}

/** Stable plugin seam for feature-specific Monaco decorations and interactions. */
export interface MonacoEditorExtension {
  setup(context: MonacoEditorExtensionContext): Monaco.IDisposable | Monaco.IDisposable[] | void
}

export function disposeExtensionResult(
  result: Monaco.IDisposable | Monaco.IDisposable[] | void,
): void {
  if (Array.isArray(result)) {
    for (const disposable of result) disposable.dispose()
  } else {
    result?.dispose()
  }
}
