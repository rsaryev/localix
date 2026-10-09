import { expect, test } from 'bun:test'
import type { MessageConnection } from 'vscode-jsonrpc/node'
import { createEditorFeatures, type EditorFeatureContext } from './lsp-editor-features'

const file = '/fixture/source.ts'
const position = { line: 1, character: 2 }
const range = { start: position, end: { line: 1, character: 3 } }

function fixture(reply: (method: string, params: unknown) => unknown) {
  const calls: { method: string; params: unknown }[] = []
  const ctx: EditorFeatureContext = {
    connection: {
      sendRequest: async (method: string, params: unknown) => {
        calls.push({ method, params })
        return reply(method, params)
      },
    } as unknown as MessageConnection,
    capabilities: {},
    isDisposed: () => false,
  }
  return { ctx, calls, features: createEditorFeatures(ctx) }
}

test('code actions read live capabilities and send explicit triggers and original diagnostics', async () => {
  const { ctx, calls, features } = fixture(() => [])
  const diagnostics = [{ range, severity: 1, message: 'error' }]
  const kinds = ['source']
  expect(await features.codeAction(file, range, diagnostics)).toEqual([])
  expect(calls).toEqual([])
  ctx.capabilities = { codeActionProvider: true }
  await features.codeAction(file, range, diagnostics, kinds, 'automatic')
  await features.codeAction(file, range, diagnostics)
  expect(calls).toEqual([
    {
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri: 'file:///fixture/source.ts' },
        range,
        context: { diagnostics, only: kinds, triggerKind: 2 },
      },
    },
    {
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri: 'file:///fixture/source.ts' },
        range,
        context: { diagnostics, only: ['quickfix'], triggerKind: 1 },
      },
    },
  ])
  const first = calls[0]!.params as { context: { diagnostics: unknown; only: unknown } }
  expect(first.context.diagnostics).toBe(diagnostics)
  expect(first.context.only).toBe(kinds)
})

test('lazy action resolution echoes opaque data and keeps the existing quickfix scope', async () => {
  const data = { opaque: ['server token'] }
  const { calls, features } = fixture(() => ({
    title: 'Resolved',
    kind: 'source.organizeImports',
    data,
  }))
  const action = { title: 'Original', kind: 'source.organizeImports', data, isPreferred: true }
  expect(await features.resolveCodeAction(action)).toBeNull()
  expect(calls).toEqual([
    {
      method: 'codeAction/resolve',
      params: {
        title: action.title,
        kind: action.kind,
        data,
      },
    },
  ])
  expect((calls[0]!.params as { data: unknown }).data).toBe(data)
})

test('failed mutations keep neutral values and disposed requests never reach the connection', async () => {
  const { ctx, calls, features } = fixture(() => {
    throw new Error('request rejected')
  })
  ctx.capabilities = { documentFormattingProvider: true, codeActionProvider: true }
  const options = { tabSize: 2, insertSpaces: true }
  expect(await features.prepareRename(file, position)).toBeNull()
  expect(await features.rename(file, position, 'newName')).toEqual([])
  expect(await features.formatDocument(file, options)).toEqual([])
  expect(await features.codeAction(file, range, [])).toEqual([])
  expect(await features.resolveCodeAction({ title: 'Fix' })).toBeNull()
  expect(calls).toHaveLength(5)
  ctx.isDisposed = () => true
  expect(await features.rename(file, position, 'newName')).toEqual([])
  expect(await features.formatDocument(file, options)).toEqual([])
  expect(calls).toHaveLength(5)
})
