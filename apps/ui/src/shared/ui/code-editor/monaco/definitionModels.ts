import type * as Monaco from 'monaco-editor'
import type { DefinitionTargetSource } from '../types'
import type { MonacoApi } from './runtime'

interface SharedDefinitionModel {
  owners: Set<symbol>
  controller: AbortController
  model?: Monaco.editor.ITextModel
  owned?: boolean
  pending?: Promise<Monaco.editor.ITextModel | null>
}

const stores = new WeakMap<MonacoApi, Map<string, SharedDefinitionModel>>()

function registry(monaco: MonacoApi): Map<string, SharedDefinitionModel> {
  let current = stores.get(monaco)
  if (!current) {
    current = new Map()
    stores.set(monaco, current)
  }
  return current
}

function openEditorModel(monaco: MonacoApi, file: string): Monaco.editor.ITextModel | undefined {
  return monaco.editor
    .getModels()
    .find(
      (candidate) =>
        !candidate.isDisposed() &&
        candidate.uri.fsPath === file &&
        candidate.uri.query.startsWith('localix-editor='),
    )
}

/**
 * Gives standalone Monaco resolvable target models for definition-link previews and
 * multi-target peek. Models are shared and reference-counted across mounted editors;
 * real open editor models win so previews include unsaved buffers.
 */
export function createDefinitionModelStore(monaco: MonacoApi): {
  resolve(file: string, source?: DefinitionTargetSource): Promise<Monaco.Uri>
  dispose(): void
} {
  const owner = Symbol('definition-model-owner')
  const acquired = new Set<string>()
  let disposed = false

  return {
    async resolve(file, source) {
      const open = openEditorModel(monaco, file)
      if (open) return open.uri

      const uri = monaco.Uri.file(file)
      if (!source || disposed) return uri
      const key = uri.toString()
      const models = registry(monaco)
      let entry = models.get(key)
      if (!entry) {
        const existing = monaco.editor.getModel(uri)
        if (existing && !existing.isDisposed()) return existing.uri
        entry = { owners: new Set(), controller: new AbortController() }
        models.set(key, entry)
      }
      if (!acquired.has(key)) {
        acquired.add(key)
        entry.owners.add(owner)
      }
      if (entry.model && !entry.model.isDisposed()) return entry.model.uri

      entry.pending ??= source(file, entry.controller.signal)
        .then((target) => {
          if (!target || entry!.controller.signal.aborted) return null
          const live = openEditorModel(monaco, file)
          if (live) return live
          const existing = monaco.editor.getModel(uri)
          if (existing && !existing.isDisposed()) return existing
          const created = monaco.editor.createModel(target.content, target.language, uri)
          entry!.model = created
          entry!.owned = true
          if (entry!.owners.size === 0) {
            created.dispose()
            models.delete(key)
            return null
          }
          return created
        })
        .catch(() => null)

      const target = await entry.pending
      if (!entry.model) entry.pending = undefined
      return target && !target.isDisposed() ? target.uri : uri
    },

    dispose() {
      if (disposed) return
      disposed = true
      const models = registry(monaco)
      for (const key of acquired) {
        const entry = models.get(key)
        if (!entry) continue
        entry.owners.delete(owner)
        if (entry.owners.size > 0) continue
        entry.controller.abort()
        if (entry.owned && entry.model && !entry.model.isDisposed()) entry.model.dispose()
        models.delete(key)
      }
      acquired.clear()
    },
  }
}
