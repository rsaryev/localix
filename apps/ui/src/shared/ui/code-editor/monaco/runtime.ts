import type * as MonacoModule from 'monaco-editor/editor/editor.api.js'

export type MonacoApi = typeof MonacoModule

let runtime: Promise<MonacoApi> | undefined

/** Monaco is intentionally loaded on demand so chat-only sessions do not pay for the editor. */
export function loadMonaco(): Promise<MonacoApi> {
  runtime ??= import('./runtimeBundle').then((module) => module.monaco)
  return runtime
}
