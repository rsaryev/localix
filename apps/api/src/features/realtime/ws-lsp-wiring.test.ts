/// <reference types="bun" />

import { createChatFeaturePorts } from '../../bootstrap/chat-feature-ports'
import { describe, expect, it } from 'bun:test'
import { testWork } from '../../testing/work-fixture'

import { createApp } from '../../app'
import {
  createTestCatalogService as createCatalogService,
  createTestChatService as createChatService,
} from '../chat/test-harness'
import { createDatabase, destroyDatabase } from '../../db'
import { createProviderConnectionsService } from '../provider-connections/service'
import { createLogger } from '../../lib/logger'
import { websocket } from './ws'

/**
 * The composition root, end-to-end, over a REAL websocket.
 *
 * The unit under test is `app.ts`'s `lsp:` wiring — NOT `ws-lsp.ts`. The channel
 * has always forwarded `kinds` correctly; the defect lived in the hand-written
 * adapter object the composition root passed it, which re-typed the service's
 * signature one parameter short. TypeScript accepts a 4-param function where a
 * 5-param one is expected, so only a test that drives the socket through the real
 * `createApp` wiring can observe the dropped argument.
 */

interface CodeActionCall {
  userId: string
  sessionId: string
  file: string
  range: unknown
  kinds: string[] | undefined
}

/** A spy standing in for `LspDocumentService`, recording what the wiring forwards. */
function createLspSpy() {
  const codeActionCalls: CodeActionCall[] = []
  const service = {
    open: async () => {},
    change: async () => {},
    save: async () => {},
    close: async () => {},
    hover: async () => null,
    completion: async () => [],
    definition: async () => null,
    implementation: async () => [],
    typeDefinition: async () => [],
    references: async () => [],
    documentHighlight: async () => [],
    signatureHelp: async () => null,
    inlayHint: async () => [],
    documentColor: async () => [],
    documentSymbols: async () => [],
    workspaceSymbols: async () => [],
    prepareRename: async () => null,
    rename: async () => ({ changedFiles: [], files: [] }),
    formatDocument: async () => null,
    codeAction: async (
      userId: string,
      sessionId: string,
      file: string,
      range: unknown,
      kinds?: string[],
    ) => {
      codeActionCalls.push({ userId, sessionId, file, range, kinds })
      return []
    },
    applyCodeAction: async () => ({ changedFiles: [], files: [] }),
    dispose: () => {},
  }
  return { service, codeActionCalls }
}

/** Boot the real app over a real Bun socket and hand back a connected client. */
async function withRealtimeSocket<T>(
  overrides: { lspDocumentService?: unknown; interact?: unknown },
  run: (rpc: (body: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>,
): Promise<T> {
  const db = createDatabase()
  const catalogService = createCatalogService()
  const providerConnectionsService = createProviderConnectionsService({ db })
  const chatService = createChatService({
    db,
    work: testWork(db),
    ports: createChatFeaturePorts(db),
    catalogService,
    providerConnectionsService,
  })
  if (overrides.interact) Object.assign(chatService, { interact: overrides.interact })
  const app = createApp({
    logger: createLogger('error'),
    defaultUserId: 'local-user',
    catalogService,
    chatService,
    providerConnectionsService,
    // The rest of the dep set is never dereferenced for the commands under test.
    lspDocumentService: overrides.lspDocumentService,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket })
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc/ws`)
    const pending = new Map<string, (body: Record<string, unknown>) => void>()
    socket.addEventListener('message', (event) => {
      const raw = String(event.data)
      if (!raw.startsWith('r\n')) return // firehose / journal / plugin frame — not an RPC reply
      const body = JSON.parse(raw.slice(2)) as Record<string, unknown>
      pending.get(String(body.id))?.(body)
    })
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('socket failed to open')))
    })

    let nextId = 0
    const rpc = (body: Record<string, unknown>) => {
      const id = `q${++nextId}`
      return new Promise<Record<string, unknown>>((resolve) => {
        pending.set(id, resolve)
        socket.send(JSON.stringify({ id, ...body }))
      })
    }

    const result = await run(rpc)
    socket.close()
    return result
  } finally {
    await server.stop(true)
    await destroyDatabase(db)
  }
}

const RANGE = { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } }

describe('app.ts realtime LSP wiring', () => {
  it('forwards `kinds` from an lsp.codeAction command through to the service', async () => {
    const { service, codeActionCalls } = createLspSpy()

    const reply = await withRealtimeSocket({ lspDocumentService: service }, (rpc) =>
      rpc({
        t: 'lsp.codeAction',
        sessionId: 's1',
        file: '/repo/a.ts',
        range: RANGE,
        kinds: ['source.organizeImports'],
      }),
    )

    expect(reply.ok).toBe(true)
    expect(codeActionCalls).toHaveLength(1)
    // The defect: the composition root's 4-param adapter dropped this argument, so
    // the service fell back to its `['quickfix']` default and "Organize imports"
    // silently returned quick-fixes.
    expect(codeActionCalls[0]?.kinds).toEqual(['source.organizeImports'])
  })

  it('still forwards an omitted `kinds` as undefined (service default applies)', async () => {
    const { service, codeActionCalls } = createLspSpy()

    await withRealtimeSocket({ lspDocumentService: service }, (rpc) =>
      rpc({ t: 'lsp.codeAction', sessionId: 's1', file: '/repo/a.ts', range: RANGE }),
    )

    expect(codeActionCalls).toHaveLength(1)
    expect(codeActionCalls[0]?.kinds).toBeUndefined()
  })
})

describe('app.ts realtime interact wiring (ownership gate)', () => {
  it("forwards the socket's authenticated user as `callerUserId`", async () => {
    const calls: unknown[][] = []
    const interact = (...args: unknown[]) => {
      calls.push(args)
      return { ok: true }
    }

    const reply = await withRealtimeSocket({ interact }, (rpc) =>
      rpc({ t: 'interact', toolCallId: 'tc1', action: 'dismiss' }),
    )

    expect(reply.ok).toBe(true)
    expect(calls).toHaveLength(1)
    // The 4th argument is `callerUserId`, the cross-tenant ownership gate. ws.ts
    // passes the socket's user; the composition root's 3-param binding used to drop
    // it. An ABSENT callerUserId means "trusted internal caller" to
    // `isInteractAllowedForOwner`, which allows everything — so dropping it left
    // every HITL respond/dismiss over the websocket ungated.
    expect(calls[0]?.[3]).toBe('local-user')
  })
})
