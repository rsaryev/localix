import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLspDocumentService, type LspServiceDeps } from './service'
import type { LspCodeAction } from './lsp-client'
import type { LspServerState } from './lsp-manager-types'

// Minimal fake LspManager — records the calls the service makes.
function makeDeps() {
  const calls: { op: string; root: string; file: string }[] = []
  const pushes: { userId: string; sessionId: string; file: string }[] = []
  const lspManager = {
    openDocument: async (root: string, file: string) => {
      calls.push({ op: 'open', root, file })
    },
    changeDocument: async (root: string, file: string) => {
      calls.push({ op: 'change', root, file })
    },
    closeDocument: async (root: string, file: string) => {
      calls.push({ op: 'close', root, file })
    },
    getFileDiagnostics: () => [],
    onUpdate: () => () => {},
  } as unknown as LspServiceDeps['lspManager']
  const deps: LspServiceDeps = {
    lspManager,
    resolveProjectRoot: async (userId: string) => `/root/${userId}`,
    publish: (userId, sessionId, push) => {
      pushes.push({ userId, sessionId, file: push.file })
    },
    // Only reached via commitWorkspaceEdit, which these ownership tests never drive.
    writeFile: async (_userId, _sessionId, _file, _content, _baseHash) => ({ hash: 'unused' }),
  }
  return { deps, calls, pushes }
}

describe('LspDocumentService ownership', () => {
  test('change/close from a different user than the opener are no-ops', async () => {
    const { deps, calls } = makeDeps()
    const svc = createLspDocumentService(deps)
    await svc.open('alice', 'sess-1', 'a.ts', 'x')
    calls.length = 0

    // Bob knows the (enumerable) session id but does not own the doc.
    await svc.change('bob', 'sess-1', 'a.ts', 'evil')
    await svc.close('bob', 'sess-1', 'a.ts')
    expect(calls).toEqual([]) // neither touched the language server

    // The real owner still works.
    await svc.change('alice', 'sess-1', 'a.ts', 'ok')
    expect(calls.some((c) => c.op === 'change')).toBe(true)
  })

  test('owner close releases the server document', async () => {
    const { deps, calls } = makeDeps()
    const svc = createLspDocumentService(deps)
    await svc.open('alice', 'sess-1', 'a.ts', 'x')
    calls.length = 0
    await svc.close('alice', 'sess-1', 'a.ts')
    expect(calls).toEqual([{ op: 'close', root: '/root/alice', file: 'a.ts' }])
  })
})

describe('LspDocumentService navigation (implementation / typeDefinition)', () => {
  // Both mirror `references`: shape the FULL location list from the manager into
  // CodeReference[] (uri→path + label + preview), or [] when the manager returns [].
  // The editor decides jump-to-first vs open-the-peek from the list length.
  function navDeps(
    locations: { uri: string; range: { start: { line: number; character: number } } }[],
  ) {
    const calls: string[] = []
    const deps: LspServiceDeps = {
      lspManager: {
        implementation: async () => {
          calls.push('implementation')
          return locations
        },
        typeDefinition: async () => {
          calls.push('typeDefinition')
          return locations
        },
        onUpdate: () => () => {},
      } as unknown as LspServiceDeps['lspManager'],
      resolveProjectRoot: async () => '/root',
      publish: () => {},
      // Navigation is read-only; no test here drives an edit commit.
      writeFile: async () => ({ hash: 'unused' }),
    }
    return { deps, calls }
  }
  const pos = { line: 1, character: 2 }

  test('implementation returns the FULL location list shaped as CodeReference[]', async () => {
    const { deps, calls } = navDeps([
      { uri: 'file:///a/impl.ts', range: { start: { line: 4, character: 6 } } },
      { uri: 'file:///a/other.ts', range: { start: { line: 9, character: 0 } } },
    ])
    const svc = createLspDocumentService(deps)
    expect(await svc.implementation('alice', 'sess-1', '/a/x.ts', pos)).toEqual([
      { file: '/a/impl.ts', fileLabel: 'impl.ts', line: 4, character: 6, preview: '' },
      { file: '/a/other.ts', fileLabel: 'other.ts', line: 9, character: 0, preview: '' },
    ])
    expect(calls).toEqual(['implementation'])
  })

  test('typeDefinition returns the location list shaped as CodeReference[]', async () => {
    const { deps } = navDeps([
      { uri: 'file:///a/types.ts', range: { start: { line: 0, character: 0 } } },
    ])
    const svc = createLspDocumentService(deps)
    expect(await svc.typeDefinition('alice', 'sess-1', '/a/x.ts', pos)).toEqual([
      { file: '/a/types.ts', fileLabel: 'types.ts', line: 0, character: 0, preview: '' },
    ])
  })

  test('both return [] when the server has no provider (empty result)', async () => {
    const { deps } = navDeps([])
    const svc = createLspDocumentService(deps)
    expect(await svc.implementation('alice', 'sess-1', '/a/x.ts', pos)).toEqual([])
    expect(await svc.typeDefinition('alice', 'sess-1', '/a/x.ts', pos)).toEqual([])
  })
})

describe('LspDocumentService editor-intelligence sync ordering', () => {
  test('definition waits for the in-flight didOpen before querying the server', async () => {
    let releaseOpen!: () => void
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    let definitionCalled = false
    const deps: LspServiceDeps = {
      lspManager: {
        openDocument: async () => openGate,
        definition: async () => {
          definitionCalled = true
          return [
            {
              uri: 'file:///work/types.ts',
              range: { start: { line: 7, character: 3 }, end: { line: 7, character: 8 } },
            },
          ]
        },
        getFileDiagnostics: () => [],
        onUpdate: () => () => {},
      } as unknown as LspServiceDeps['lspManager'],
      resolveProjectRoot: async () => '/work',
      publish: () => {},
      writeFile: async () => ({ hash: 'unused' }),
    }
    const svc = createLspDocumentService(deps)

    // The websocket intentionally does not await this promise before acknowledging
    // lsp.open. Navigation may arrive immediately, before even root resolution.
    const opening = svc.open('alice', 'sess-1', '/work/main.ts', 'import "./types"')
    const navigating = svc.definition('alice', 'sess-1', '/work/main.ts', {
      line: 0,
      character: 10,
    })
    await Promise.resolve()

    expect(definitionCalled).toBe(false)
    releaseOpen()
    expect(await navigating).toEqual([{ file: '/work/types.ts', line: 7, character: 3 }])
    await opening
  })

  test('definition retries a transient self-location from a warming TypeScript project', async () => {
    let calls = 0
    const deps: LspServiceDeps = {
      lspManager: {
        definition: async () => {
          calls++
          return calls === 1
            ? [
                {
                  uri: 'file:///work/main.ts',
                  range: { start: { line: 0, character: 14 }, end: { line: 0, character: 29 } },
                },
              ]
            : [
                {
                  uri: 'file:///work/types.ts',
                  range: { start: { line: 9, character: 12 }, end: { line: 9, character: 27 } },
                },
              ]
        },
        onUpdate: () => () => {},
      } as unknown as LspServiceDeps['lspManager'],
      resolveProjectRoot: async () => '/work',
      publish: () => {},
      writeFile: async () => ({ hash: 'unused' }),
    }
    const svc = createLspDocumentService(deps)

    expect(
      await svc.definition('alice', 'sess-1', '/work/main.ts', { line: 0, character: 16 }),
    ).toEqual([{ file: '/work/types.ts', line: 9, character: 12 }])
    expect(calls).toBe(2)
  })

  test('definition keeps distinct targets and removes a transient self-location', async () => {
    const deps: LspServiceDeps = {
      lspManager: {
        definition: async () => [
          {
            uri: 'file:///work/main.ts',
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 14 } },
          },
          {
            uri: 'file:///work/a.ts',
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
          },
          {
            uri: 'file:///work/a.ts',
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
          },
          {
            uri: 'file:///work/b.ts',
            range: { start: { line: 5, character: 1 }, end: { line: 5, character: 5 } },
          },
        ],
        onUpdate: () => () => {},
      } as unknown as LspServiceDeps['lspManager'],
      resolveProjectRoot: async () => '/work',
      publish: () => {},
      writeFile: async () => ({ hash: 'unused' }),
    }
    const svc = createLspDocumentService(deps)

    expect(
      await svc.definition('alice', 'sess-1', '/work/main.ts', { line: 0, character: 12 }),
    ).toEqual([
      { file: '/work/a.ts', line: 2, character: 4 },
      { file: '/work/b.ts', line: 5, character: 1 },
    ])
  })
})

describe('LspDocumentService.applyCodeAction', () => {
  test('commits an eager edit through the locked write path and returns new content', async () => {
    const target = join(tmpdir(), `lsp-codeaction-${Date.now()}.ts`)
    await Bun.write(target, 'const x = 1\n')
    const writes: { file: string; content: string; baseHash: string }[] = []
    let resolveCalled = false
    const deps: LspServiceDeps = {
      lspManager: {
        resolveCodeAction: async () => {
          resolveCalled = true
          return null
        },
        onUpdate: () => () => {},
      } as unknown as LspServiceDeps['lspManager'],
      resolveProjectRoot: async () => '/root',
      publish: () => {},
      writeFile: async (_u, _s, file, content, baseHash) => {
        writes.push({ file, content, baseHash })
        return { hash: 'h' }
      },
    }
    const svc = createLspDocumentService(deps)
    const action: LspCodeAction = {
      title: 'Rename x → y',
      kind: 'quickfix',
      edit: [
        {
          file: target,
          edits: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
              newText: 'y',
            },
          ],
        },
      ],
    }
    const result = await svc.applyCodeAction('alice', 'sess-1', target, action)
    expect(resolveCalled).toBe(false) // eager edit → no resolve round-trip
    expect(writes).toHaveLength(1)
    expect(writes[0].content).toBe('const y = 1\n')
    expect(result.changedFiles).toEqual([target])
    expect(result.files[0].content).toBe('const y = 1\n')
  })

  test('resolves a lazy action (no edit) before committing', async () => {
    const target = join(tmpdir(), `lsp-codeaction-lazy-${Date.now()}.ts`)
    await Bun.write(target, 'let a = 1\n')
    const writes: string[] = []
    const deps: LspServiceDeps = {
      lspManager: {
        resolveCodeAction: async (
          _root: string,
          _file: string,
          a: LspCodeAction,
        ): Promise<LspCodeAction> => ({
          ...a,
          edit: [
            {
              file: target,
              edits: [
                {
                  range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } },
                  newText: '2',
                },
              ],
            },
          ],
        }),
        onUpdate: () => () => {},
      } as unknown as LspServiceDeps['lspManager'],
      resolveProjectRoot: async () => '/root',
      publish: () => {},
      writeFile: async (_u, _s, _file, content) => {
        writes.push(content)
        return { hash: 'h' }
      },
    }
    const svc = createLspDocumentService(deps)
    const result = await svc.applyCodeAction('alice', 'sess-1', target, {
      title: 'Fix',
      kind: 'quickfix',
      data: { id: 1 },
    })
    expect(writes).toEqual(['let a = 2\n'])
    expect(result.changedFiles).toEqual([target])
  })

  test('a command-only action with no resolvable edit degrades to a no-op', async () => {
    const deps: LspServiceDeps = {
      lspManager: {
        resolveCodeAction: async () => null,
        onUpdate: () => () => {},
      } as unknown as LspServiceDeps['lspManager'],
      resolveProjectRoot: async () => '/root',
      publish: () => {},
      writeFile: async () => {
        throw new Error('must not write')
      },
    }
    const svc = createLspDocumentService(deps)
    const result = await svc.applyCodeAction('alice', 'sess-1', '/x.ts', {
      title: 'Do',
      command: { command: 'x', title: 'x' },
    })
    expect(result).toEqual({ changedFiles: [], files: [] })
  })
})

/**
 * One WebSocket per browser tab, and the service keys documents by (session, file) —
 * so two tabs (or two split panes) on the same file are two HOLDERS of one entry.
 */
describe('LspDocumentService — two holders of the same buffer', () => {
  test('one holder closing does NOT close the document on the server', () => {
    const { deps, calls } = makeDeps()
    const svc = createLspDocumentService(deps)

    return (async () => {
      await svc.open('alice', 'sess-1', 'a.ts', 'x', 'tab-A')
      await svc.open('alice', 'sess-1', 'a.ts', 'x', 'tab-B')
      await svc.close('alice', 'sess-1', 'a.ts', 'tab-A')

      // The bug: tab B still has the buffer live, but the server was told to close it,
      // so B's diagnostics went silent for good.
      expect(calls.filter((c) => c.op === 'close')).toEqual([])
    })()
  })

  test('the LAST holder closing DOES close it — the reverse direction', async () => {
    // Without this the fix would leak every document on the language server forever.
    const { deps, calls } = makeDeps()
    const svc = createLspDocumentService(deps)

    await svc.open('alice', 'sess-1', 'a.ts', 'x', 'tab-A')
    await svc.open('alice', 'sess-1', 'a.ts', 'x', 'tab-B')
    await svc.close('alice', 'sess-1', 'a.ts', 'tab-A')
    await svc.close('alice', 'sess-1', 'a.ts', 'tab-B')

    expect(calls.filter((c) => c.op === 'close')).toEqual([
      { op: 'close', root: '/root/alice', file: 'a.ts' },
    ])
  })

  test('a single unnamed holder still closes on its first close', async () => {
    // The other reverse direction: callers that pass no consumer id (tests, internal
    // callers) must keep the old one-holder behaviour, not refcount to never-close.
    const { deps, calls } = makeDeps()
    const svc = createLspDocumentService(deps)

    await svc.open('alice', 'sess-1', 'a.ts', 'x')
    await svc.close('alice', 'sess-1', 'a.ts')

    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1)
  })

  test('re-opening from the SAME holder is idempotent, not a second claim', async () => {
    // An editor remount re-sends `lsp.open` over the same socket. If that counted twice,
    // the single close that follows would leave the document open forever.
    const { deps, calls } = makeDeps()
    const svc = createLspDocumentService(deps)

    await svc.open('alice', 'sess-1', 'a.ts', 'x', 'tab-A')
    await svc.open('alice', 'sess-1', 'a.ts', 'x', 'tab-A')
    await svc.close('alice', 'sess-1', 'a.ts', 'tab-A')

    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1)
  })
})

describe('LspDocumentService server status', () => {
  test('a server installing for an open file reaches that session without an agent run', async () => {
    const { deps } = makeDeps()
    let notify!: (root: string, states: LspServerState[]) => void
    deps.lspManager.onUpdate = (handler) => {
      notify = handler
      return () => {}
    }
    const statuses: [string, string, string[]][] = []
    const svc = createLspDocumentService({
      ...deps,
      publishStatus: (userId, sessionId, servers) =>
        statuses.push([userId, sessionId, servers.map((s) => s.status)]),
    })
    await svc.open('alice', 'sess-1', 'main.go', 'package main')
    const installing = [
      {
        serverId: 'go',
        serverName: 'Go',
        rootDir: '/root/alice',
        status: 'installing',
        errorCount: 0,
        warningCount: 0,
      },
    ] satisfies LspServerState[]
    notify('/root/alice', installing)
    // The same states again are not news; another project's are not this session's.
    notify('/root/alice', installing)
    notify('/root/bob', [{ ...installing[0], status: 'ready' }])
    notify('/root/alice', [{ ...installing[0], status: 'ready' }])

    expect(statuses).toEqual([
      ['alice', 'sess-1', ['installing']],
      ['alice', 'sess-1', ['ready']],
    ])
  })
})
