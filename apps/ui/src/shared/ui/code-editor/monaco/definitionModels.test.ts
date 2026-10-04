import { describe, expect, test } from 'bun:test'
import type * as Monaco from 'monaco-editor'
import { createDefinitionModelStore } from './definitionModels'
import type { MonacoApi } from './runtime'

function harness() {
  const models: Monaco.editor.ITextModel[] = []
  const disposed: string[] = []
  const uri = (file: string, query = '') =>
    ({
      fsPath: file,
      query,
      toString: () => `file://${file}${query ? `?${query}` : ''}`,
    }) as Monaco.Uri
  const createModel = (content: string, _language: string, modelUri: Monaco.Uri) => {
    let dead = false
    const model = {
      uri: modelUri,
      getValue: () => content,
      isDisposed: () => dead,
      dispose: () => {
        if (dead) return
        dead = true
        disposed.push(modelUri.toString())
      },
    } as unknown as Monaco.editor.ITextModel
    models.push(model)
    return model
  }
  const monaco = {
    Uri: { file: (file: string) => uri(file) },
    editor: {
      getModels: () => models,
      getModel: (candidate: Monaco.Uri) =>
        models.find(
          (model) => !model.isDisposed() && model.uri.toString() === candidate.toString(),
        ),
      createModel,
    },
  } as unknown as MonacoApi
  return { monaco, models, disposed, uri, createModel }
}

describe('definition target model lifecycle', () => {
  test('shares a lazily loaded target until the final editor releases it', async () => {
    const h = harness()
    const first = createDefinitionModelStore(h.monaco)
    const second = createDefinitionModelStore(h.monaco)
    let reads = 0
    const source = async () => {
      reads++
      return { content: 'export const target = 1', language: 'typescript' }
    }

    const [a, b] = await Promise.all([
      first.resolve('/work/target.ts', source),
      second.resolve('/work/target.ts', source),
    ])

    expect(a.toString()).toBe('file:///work/target.ts')
    expect(b.toString()).toBe(a.toString())
    expect(reads).toBe(1)
    first.dispose()
    expect(h.disposed).toEqual([])
    second.dispose()
    expect(h.disposed).toEqual(['file:///work/target.ts'])
  })

  test('prefers a live editor model and never reloads or owns it', async () => {
    const h = harness()
    const openUri = h.uri('/work/target.ts', 'localix-editor=7')
    const openModel = h.createModel('unsaved target', 'typescript', openUri)
    const store = createDefinitionModelStore(h.monaco)
    let reads = 0

    const resolved = await store.resolve('/work/target.ts', async () => {
      reads++
      return { content: 'disk target', language: 'typescript' }
    })
    store.dispose()

    expect(resolved).toBe(openUri)
    expect(reads).toBe(0)
    expect(openModel.isDisposed()).toBe(false)
    expect(h.disposed).toEqual([])
  })

  test('falls back to the canonical URI when a target cannot be loaded', async () => {
    const h = harness()
    const store = createDefinitionModelStore(h.monaco)
    const resolved = await store.resolve('/work/missing.ts', async () => {
      throw new Error('gone')
    })

    expect(resolved.toString()).toBe('file:///work/missing.ts')
    expect(h.models).toEqual([])
    store.dispose()
  })
})
