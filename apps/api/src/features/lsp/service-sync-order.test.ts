import { describe, expect, test } from 'bun:test'
import { createLspDocumentService, type LspServiceDeps } from './service'

/**
 * A language-server request must never be answered against a document the editor has
 * already moved past.
 *
 * The exposure is format-on-save. The editor sends `lsp.change` WITHOUT awaiting it and
 * asks for a format — both over the same `/rpc/ws` mux, so they are delivered in order but
 * handled as two independent async chains. If the format is answered first, its edits are
 * computed against the older document text while being fingerprinted as the newer one, and
 * the editor splices misaligned ranges into the buffer it then saves — a silently corrupted
 * file on ⌘S. Every other request (completion, a quick fix) rides the same barrier.
 *
 * `service.change` only extends `doc.syncing` AFTER `await ownedOpenDoc(...)`, so the
 * barrier every read-side request awaits is installed one microtask late. It holds today
 * because the change handler is invoked first and its continuation is queued first — an
 * ordering property nothing states and nothing else enforces. Any future await added
 * ahead of that assignment silently opens the window, which is why this is pinned here
 * rather than left to the comment.
 */
function makeDeps() {
  const calls: string[] = []
  let changeSeen: string | undefined
  const lspManager = {
    openDocument: async () => {
      calls.push('open')
    },
    // Deliberately SLOW: a sync barrier that is missing (rather than merely fast) is
    // only visible when the document update takes more than a microtask to land, which
    // is the real case — it crosses a process boundary to the language server.
    changeDocument: async (_root: string, _file: string, content: string) => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      changeSeen = content
      calls.push('change')
    },
    closeDocument: async () => {
      calls.push('close')
    },
    formatDocument: async () => {
      calls.push('format')
      return [] // no edits → the service returns null and never touches disk
    },
    getFileDiagnostics: () => [],
    onUpdate: () => () => {},
  } as unknown as LspServiceDeps['lspManager']
  const deps: LspServiceDeps = {
    lspManager,
    resolveProjectRoot: async () => '/root',
    publish: () => {},
    writeFile: async () => ({ hash: 'unused' }),
  }
  return { deps, calls, changed: () => changeSeen }
}

describe('LSP document sync ordering', () => {
  test('a format issued right behind an un-awaited change waits for that change', async () => {
    const { deps, calls, changed } = makeDeps()
    const svc = createLspDocumentService(deps)
    await svc.open('alice', 's1', '/w/a.ts', 'const a=1')
    calls.length = 0

    // Exactly what the editor does on ⌘S with format-on-save: fire the document
    // update, do not await it, ask for the format.
    const change = svc.change('alice', 's1', '/w/a.ts', 'const a=1;const b=2')
    const format = svc.formatDocument('alice', 's1', '/w/a.ts', {
      tabSize: 2,
      insertSpaces: true,
    })
    await Promise.all([change, format])

    expect(calls).toEqual(['change', 'format'])
    expect(changed()).toBe('const a=1;const b=2')
  })

  test('the same barrier holds for a whole burst of un-awaited changes', async () => {
    const { deps, calls, changed } = makeDeps()
    const svc = createLspDocumentService(deps)
    await svc.open('alice', 's1', '/w/a.ts', 'v0')
    calls.length = 0

    // Typing that outruns the debounce: several updates in flight when the save lands.
    const writes = ['v1', 'v2', 'v3'].map((v) => svc.change('alice', 's1', '/w/a.ts', v))
    const format = svc.formatDocument('alice', 's1', '/w/a.ts', {
      tabSize: 2,
      insertSpaces: true,
    })
    await Promise.all([...writes, format])

    // The formatter runs last, on the newest text — not interleaved into the burst.
    expect(calls).toEqual(['change', 'change', 'change', 'format'])
    expect(changed()).toBe('v3')
  })
})
