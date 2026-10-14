import { expect, test } from 'bun:test'
import type { MessageConnection } from 'vscode-jsonrpc/node'
import type { CapabilityRegistration, DiagnosticRequestResult } from './lsp-client-contract'
import { createDiagnosticPullCoordinator } from './lsp-diagnostics-coordinator'

test('workspace pulls share pending identifiers and request fresh reports after settlement', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls: unknown[] = []
  const registrations = new Map<string, CapabilityRegistration>([
    [
      'one',
      {
        id: 'one',
        method: 'textDocument/diagnostic',
        registerOptions: {
          workspaceDiagnostics: true,
          identifier: '',
        },
      },
    ],
    [
      'two',
      {
        id: 'two',
        method: 'textDocument/diagnostic',
        registerOptions: {
          workspaceDiagnostics: true,
          identifier: 'named',
        },
      },
    ],
    [
      'duplicate',
      {
        id: 'duplicate',
        method: 'textDocument/diagnostic',
        registerOptions: {
          workspaceDiagnostics: true,
          identifier: 'named',
        },
      },
    ],
  ])
  const inFlight = new Map<string, Promise<DiagnosticRequestResult>>()
  const merged: DiagnosticRequestResult[][] = []
  const request = createDiagnosticPullCoordinator({
    connection: {
      sendRequest: async (method: string, params: unknown) => {
        calls.push([method, params])
        await gate
        return { items: [] }
      },
    } as unknown as MessageConnection,
    diagnosticRegistrations: registrations,
    hasStaticPullDiagnostics: () => false,
    getWorkspacePullInFlight: () => inFlight,
    mergePullResults: (_file, results) => {
      merged.push(results)
      return { handled: true, matched: false }
    },
  })
  try {
    const pending = [request('/fixture/one'), request('/fixture/two')]
    expect(calls).toEqual([
      ['workspace/diagnostic', { previousResultIds: [] }],
      ['workspace/diagnostic', { identifier: 'named', previousResultIds: [] }],
    ])
    expect(inFlight.size).toBe(2)
    release()
    await Promise.all(pending)
    expect(inFlight.size).toBe(0)
    expect(merged[0]).toHaveLength(3)
    expect(merged[0]![0]).toBe(merged[0]![1])
    expect(merged[0]![2]).toBe(merged[1]![2])
    await request('/fixture/three')
    expect(calls).toHaveLength(4)
  } finally {
    release()
  }
})

test('live document registrations add ordered unique identifiers without sharing file requests', async () => {
  const calls: unknown[] = []
  const registrations = new Map<string, CapabilityRegistration>()
  let staticPull = false
  const request = createDiagnosticPullCoordinator({
    connection: {
      sendRequest: async (method: string, params: unknown) => {
        calls.push([method, params])
        return { items: [] }
      },
    } as unknown as MessageConnection,
    diagnosticRegistrations: registrations,
    hasStaticPullDiagnostics: () => staticPull,
    getWorkspacePullInFlight: () => new Map(),
    mergePullResults: (_file, results) => ({
      handled: results.some((r) => r.handled),
      matched: true,
    }),
  })
  expect(await request('/fixture/one')).toEqual({ handled: false, matched: false })
  expect(calls).toEqual([])
  for (const [id, identifier] of [
    ['one', 'a'],
    ['two', 'b'],
    ['duplicate', 'a'],
  ]) {
    registrations.set(id!, {
      id: id!,
      method: 'textDocument/diagnostic',
      registerOptions: {
        workspaceDiagnostics: false,
        identifier,
      },
    })
  }
  await Promise.all([request('/fixture/one'), request('/fixture/two')])
  expect(calls).toHaveLength(6)
  expect(calls.slice(0, 3)).toEqual([
    ['textDocument/diagnostic', { textDocument: { uri: 'file:///fixture/one' } }],
    ['textDocument/diagnostic', { identifier: 'a', textDocument: { uri: 'file:///fixture/one' } }],
    ['textDocument/diagnostic', { identifier: 'b', textDocument: { uri: 'file:///fixture/one' } }],
  ])
  registrations.clear()
  staticPull = true
  await request('/fixture/three')
  expect(calls).toHaveLength(7)
})
