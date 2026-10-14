import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MessageConnection } from 'vscode-jsonrpc/node'
import { createDocumentSync } from './lsp-document-sync'

test('a transient disk read does not close a buffer claimed while diagnostics are pending', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'localix-document-sync-'))
  const file = path.join(dir, 'source.ts')
  writeFileSync(file, 'disk content')
  const openedFiles = new Map<string, { version: number; text: string }>()
  const calls: string[] = []
  let signal!: () => void
  const requested = new Promise<void>((resolve) => {
    signal = resolve
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const documents = createDocumentSync({
    connection: {
      sendNotification: async (method: string) => {
        calls.push(method)
      },
    } as unknown as MessageConnection,
    openedFiles,
    pushDiagnostics: new Map(),
    pullDiagnostics: new Map(),
    syncKind: 1,
    saveCarriesText: false,
    isDisposed: () => false,
    waitForPush: async () => false,
    requestDiagnostics: async () => {
      signal()
      await gate
      return { handled: true, matched: true }
    },
  })
  try {
    const touching = documents.touchFileAndWait(file)
    await requested
    await documents.syncDocument(file, 'editor content')
    release()
    expect(await touching).toBe(true)
    expect(openedFiles.get(file)).toEqual({ version: 1, text: 'editor content' })
    expect(calls).toEqual([
      'workspace/didChangeWatchedFiles',
      'textDocument/didOpen',
      'textDocument/didSave',
      'textDocument/didChange',
    ])
    await documents.closeDocument(file)
    expect(openedFiles.has(file)).toBe(false)
    expect(calls.at(-1)).toBe('textDocument/didClose')
  } finally {
    release()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a rejected change keeps its advanced buffer version and close clears state despite failure', async () => {
  const file = '/fixture/source.ts'
  const openedFiles = new Map([[file, { version: 3, text: 'old' }]])
  const pushDiagnostics = new Map([[file, []]])
  const pullDiagnostics = new Map([[file, []]])
  const failure = new Error('notification failed')
  const documents = createDocumentSync({
    connection: {
      sendNotification: async () => {
        throw failure
      },
    } as unknown as MessageConnection,
    openedFiles,
    pushDiagnostics,
    pullDiagnostics,
    syncKind: 2,
    saveCarriesText: true,
    isDisposed: () => false,
    waitForPush: async () => false,
    requestDiagnostics: async () => ({ handled: false, matched: false }),
  })
  await expect(documents.syncDocument(file, 'new')).rejects.toThrow(failure)
  expect(openedFiles.get(file)).toEqual({ version: 4, text: 'new' })
  await documents.saveDocument(file)
  await documents.closeDocument(file)
  expect(openedFiles.size).toBe(0)
  expect(pushDiagnostics.size).toBe(0)
  expect(pullDiagnostics.size).toBe(0)
})
