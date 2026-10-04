import { eventSocket } from './eventSocket'
import type { BufferEdit } from '@localixai/api/lsp-edits'
import type {
  CodeLocation,
  CodeReference,
  LspCodeAction,
  LspColorInfo,
  LspCompletionItem,
  LspDocumentHighlight,
  LspDocumentSymbol,
  LspHoverInfo,
  LspInlayHint,
  LspPosition,
  LspRange,
  LspSignatureHelp,
  RenamePrepare,
  RenameResult,
  WorkspaceSymbol,
} from './contracts'

/**
 * The inspector editor ↔ language-server surface: every `lsp.*` RPC over the shared
 * `/rpc/ws` mux, in one place. Spread into `backendClient`, so callers keep saying
 * `backendClient.lspHover(…)` — this module just owns the LSP half of that object
 * instead of leaving it inlined in the 1200-line client.
 *
 * Document sync (open/change/close) is fire-and-forget: diagnostics for the file ride
 * back on the firehose as `lsp.diagnostics` (handled in applyStreamEvent).
 */

/** A request whose "nothing to report" answer is an EMPTY LIST, not null. The server
 *  may answer null (no server for the language, request superseded); every list-shaped
 *  LSP call normalizes that to `[]` so no call site repeats the `?? []`. */
async function requestList<T>(payload: Record<string, unknown>): Promise<T[]> {
  return (await eventSocket.request<T[] | null>(payload)) ?? []
}

/** The empty workspace edit — what a rename/code-action that changed nothing returns. */
const NO_EDIT: RenameResult = { changedFiles: [], files: [] }

export const lspApi = {
  async lspOpen(sessionId: string, file: string, content: string): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'lsp.open', sessionId, file, content })
  },
  async lspChange(sessionId: string, file: string, content: string): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'lsp.change', sessionId, file, content })
  },
  /** The buffer was written to disk — the language server hears `didSave` (never per keystroke). */
  async lspSave(sessionId: string, file: string): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'lsp.save', sessionId, file })
  },
  async lspClose(sessionId: string, file: string): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'lsp.close', sessionId, file })
  },
  async lspHover(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspHoverInfo | null> {
    return eventSocket.request<LspHoverInfo | null>({ t: 'lsp.hover', sessionId, file, position })
  },
  async lspCompletion(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspCompletionItem[]> {
    return requestList<LspCompletionItem>({ t: 'lsp.completion', sessionId, file, position })
  },
  async lspDefinition(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeLocation[]> {
    return requestList<CodeLocation>({
      t: 'lsp.definition',
      sessionId,
      file,
      position,
    })
  },
  async lspImplementation(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]> {
    return requestList<CodeReference>({ t: 'lsp.implementation', sessionId, file, position })
  },
  async lspTypeDefinition(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]> {
    return requestList<CodeReference>({ t: 'lsp.typeDefinition', sessionId, file, position })
  },
  async lspReferences(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]> {
    return requestList<CodeReference>({ t: 'lsp.references', sessionId, file, position })
  },
  async lspSignatureHelp(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspSignatureHelp | null> {
    return eventSocket.request<LspSignatureHelp | null>({
      t: 'lsp.signatureHelp',
      sessionId,
      file,
      position,
    })
  },
  async lspDocumentHighlight(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspDocumentHighlight[]> {
    return requestList<LspDocumentHighlight>({
      t: 'lsp.documentHighlight',
      sessionId,
      file,
      position,
    })
  },
  async lspInlayHint(sessionId: string, file: string, range: LspRange): Promise<LspInlayHint[]> {
    return requestList<LspInlayHint>({ t: 'lsp.inlayHint', sessionId, file, range })
  },
  async lspDocumentColor(sessionId: string, file: string): Promise<LspColorInfo[]> {
    return requestList<LspColorInfo>({ t: 'lsp.documentColor', sessionId, file })
  },
  async lspDocumentSymbols(sessionId: string, file: string): Promise<LspDocumentSymbol[]> {
    return requestList<LspDocumentSymbol>({ t: 'lsp.documentSymbols', sessionId, file })
  },
  async lspWorkspaceSymbols(sessionId: string, query: string): Promise<WorkspaceSymbol[]> {
    return requestList<WorkspaceSymbol>({ t: 'lsp.workspaceSymbols', sessionId, query })
  },
  async lspPrepareRename(
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<RenamePrepare | null> {
    return eventSocket.request<RenamePrepare | null>({
      t: 'lsp.prepareRename',
      sessionId,
      file,
      position,
    })
  },
  async lspRename(
    sessionId: string,
    file: string,
    position: LspPosition,
    newName: string,
  ): Promise<RenameResult> {
    return (
      (await eventSocket.request<RenameResult | null>({
        t: 'lsp.rename',
        sessionId,
        file,
        position,
        newName,
      })) ?? NO_EDIT
    )
  },
  async lspFormatDocument(
    sessionId: string,
    file: string,
    options: { tabSize: number; insertSpaces: boolean },
  ): Promise<BufferEdit | null> {
    return eventSocket.request<BufferEdit | null>({
      t: 'lsp.formatDocument',
      sessionId,
      file,
      options,
    })
  },
  async lspCodeAction(
    sessionId: string,
    file: string,
    range: LspRange,
    kinds?: string[],
    trigger?: 'invoked' | 'automatic',
  ): Promise<LspCodeAction[]> {
    return requestList<LspCodeAction>({
      t: 'lsp.codeAction',
      sessionId,
      file,
      range,
      kinds,
      ...(trigger ? { trigger } : {}),
    })
  },
  async lspApplyCodeAction(
    sessionId: string,
    file: string,
    action: LspCodeAction,
  ): Promise<RenameResult> {
    return (
      (await eventSocket.request<RenameResult | null>({
        t: 'lsp.applyCodeAction',
        sessionId,
        file,
        action,
      })) ?? NO_EDIT
    )
  },
} as const
