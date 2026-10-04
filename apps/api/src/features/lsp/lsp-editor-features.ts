import type { MessageConnection } from 'vscode-jsonrpc/node'

import { withTimeout } from '../../lib/timeout'
import {
  CODE_ACTION_TRIGGER_AUTOMATIC,
  CODE_ACTION_TRIGGER_INVOKED,
  DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  fileUri,
  markupToText,
  normalizeCallHierarchyItems,
  normalizeCodeActions,
  normalizeCompletionItems,
  normalizeDocumentColors,
  normalizeDocumentHighlights,
  normalizeDocumentSymbols,
  normalizeInlayHints,
  normalizeIncomingCallSites,
  normalizeLocations,
  normalizeOutgoingCallSites,
  normalizePrepareRename,
  normalizeSignatureHelp,
  normalizeTextEdits,
  normalizeWorkspaceEdit,
  normalizeWorkspaceSymbols,
  type CodeActionTrigger,
  type LspCallHierarchyItem,
  type LspClientInfo,
  type LspCodeAction,
  type LspColorInfo,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentHighlight,
  type LspDocumentSymbol,
  type LspFormattingOptions,
  type LspHoverInfo,
  type LspInlayHint,
  type LspLocation,
  type LspPosition,
  type LspPrepareRename,
  type LspRange,
  type LspSignatureHelp,
  type LspTextEdit,
  type LspWorkspaceEditFile,
  type LspWorkspaceSymbol,
  type ServerCapabilities,
} from './lsp-protocol'

/**
 * The EDITOR-INTELLIGENCE half of an LSP client: hover, completion, go-to-*, call
 * hierarchy, symbols, rename, format, code actions.
 *
 * Every one of these is a STATELESS round-trip — ask the server, normalize the
 * reply, degrade to a neutral value. They share nothing with the client's other
 * half (the diagnostics state machine: push/pull maps, open-document versions,
 * debouncer, capability registrations), which is why they lift out cleanly. All
 * they need is the three things below.
 *
 * The two halves have different reasons to change: a new LSP feature request lands
 * here; a change to how diagnostics are merged/debounced lands there. Splitting
 * them keeps each readable on its own.
 */
export interface EditorFeatureContext {
  /** The live JSON-RPC connection to the server. */
  connection: MessageConnection
  /** What the server advertised at `initialize` — gates the optional providers. */
  capabilities: ServerCapabilities | undefined
  /** Read at CALL time: a disposed client answers neutrally instead of throwing. */
  isDisposed: () => boolean
}

/** The subset of `LspClientInfo` these features provide. */
export type EditorFeatures = Pick<
  LspClientInfo,
  | 'hover'
  | 'completion'
  | 'definition'
  | 'references'
  | 'implementation'
  | 'typeDefinition'
  | 'incomingCalls'
  | 'outgoingCalls'
  | 'documentHighlight'
  | 'signatureHelp'
  | 'inlayHint'
  | 'documentColor'
  | 'documentSymbols'
  | 'workspaceSymbols'
  | 'prepareRename'
  | 'rename'
  | 'formatDocument'
  | 'codeAction'
  | 'resolveCodeAction'
>

export function createEditorFeatures(ctx: EditorFeatureContext): EditorFeatures {
  const { connection } = ctx

  // Shared shape for every `textDocument/*` feature request: skip when disposed,
  // send with the standard request timeout, normalize the raw reply, and fall
  // back to `onError` on any failure (timeout, transport, server error) so a
  // single editor query can never throw into the caller.
  async function featureRequest<T>(
    method: string,
    params: Record<string, unknown>,
    normalize: (res: unknown) => T,
    onError: T,
  ): Promise<T> {
    if (ctx.isDisposed()) return onError
    try {
      return normalize(
        await withTimeout(connection.sendRequest(method, params), DIAGNOSTICS_REQUEST_TIMEOUT_MS),
      )
    } catch {
      return onError
    }
  }

  /** A position-based request against a file — the shape 12 of these share. */
  function atPosition<T>(
    method: string,
    filePath: string,
    position: LspPosition,
    normalize: (res: unknown) => T,
    onError: T,
    extraParams: Record<string, unknown> = {},
  ): Promise<T> {
    return featureRequest(
      method,
      { textDocument: { uri: fileUri(filePath) }, position, ...extraParams },
      normalize,
      onError,
    )
  }

  function hover(filePath: string, position: LspPosition): Promise<LspHoverInfo | null> {
    return atPosition(
      'textDocument/hover',
      filePath,
      position,
      (res) => {
        const value = markupToText((res as { contents?: unknown } | null)?.contents).trim()
        return value ? { value } : null
      },
      null,
    )
  }

  function completion(filePath: string, position: LspPosition): Promise<LspCompletionItem[]> {
    return atPosition('textDocument/completion', filePath, position, normalizeCompletionItems, [])
  }

  function definition(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    return atPosition('textDocument/definition', filePath, position, normalizeLocations, [])
  }

  function references(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    return atPosition('textDocument/references', filePath, position, normalizeLocations, [], {
      context: { includeDeclaration: true },
    })
  }

  function implementation(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    // Respect the advertised capability — no provider → silent [] (like format/codeAction).
    if (!ctx.capabilities?.implementationProvider) return Promise.resolve([])
    return atPosition('textDocument/implementation', filePath, position, normalizeLocations, [])
  }

  function typeDefinition(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    // Respect the advertised capability — no provider → silent [] (mirrors implementation).
    if (!ctx.capabilities?.typeDefinitionProvider) return Promise.resolve([])
    return atPosition('textDocument/typeDefinition', filePath, position, normalizeLocations, [])
  }

  /**
   * Call hierarchy is a 2-step LSP flow: `prepareCallHierarchy` resolves the symbol
   * at the position to CallHierarchyItem(s), then the incoming/outgoing request asks
   * who calls it (call SITE locations) or what it calls (CALLEE locations). Silent []
   * when the server has no provider. The two directions differ ONLY in the second
   * method + its normalizer, so they share this body.
   */
  async function callHierarchy(
    filePath: string,
    position: LspPosition,
    method: 'callHierarchy/incomingCalls' | 'callHierarchy/outgoingCalls',
    normalize: (res: unknown) => LspLocation[],
  ): Promise<LspLocation[]> {
    if (!ctx.capabilities?.callHierarchyProvider) return []
    const items = await atPosition<LspCallHierarchyItem[]>(
      'textDocument/prepareCallHierarchy',
      filePath,
      position,
      normalizeCallHierarchyItems,
      [],
    )
    const item = items[0]
    if (!item) return []
    // Echo the server's exact item back (its `data` is round-tripped per spec).
    return featureRequest(method, { item }, normalize, [])
  }

  function incomingCalls(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    return callHierarchy(
      filePath,
      position,
      'callHierarchy/incomingCalls',
      normalizeIncomingCallSites,
    )
  }

  function outgoingCalls(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    return callHierarchy(
      filePath,
      position,
      'callHierarchy/outgoingCalls',
      normalizeOutgoingCallSites,
    )
  }

  function documentHighlight(
    filePath: string,
    position: LspPosition,
  ): Promise<LspDocumentHighlight[]> {
    return atPosition(
      'textDocument/documentHighlight',
      filePath,
      position,
      normalizeDocumentHighlights,
      [],
    )
  }

  function signatureHelp(
    filePath: string,
    position: LspPosition,
  ): Promise<LspSignatureHelp | null> {
    return atPosition(
      'textDocument/signatureHelp',
      filePath,
      position,
      normalizeSignatureHelp,
      null,
    )
  }

  function inlayHint(filePath: string, range: LspRange): Promise<LspInlayHint[]> {
    return featureRequest(
      'textDocument/inlayHint',
      { textDocument: { uri: fileUri(filePath) }, range },
      normalizeInlayHints,
      [],
    )
  }

  function documentColor(filePath: string): Promise<LspColorInfo[]> {
    return featureRequest(
      'textDocument/documentColor',
      { textDocument: { uri: fileUri(filePath) } },
      normalizeDocumentColors,
      [],
    )
  }

  function documentSymbols(filePath: string): Promise<LspDocumentSymbol[]> {
    return featureRequest(
      'textDocument/documentSymbol',
      { textDocument: { uri: fileUri(filePath) } },
      normalizeDocumentSymbols,
      [],
    )
  }

  function workspaceSymbols(query: string): Promise<LspWorkspaceSymbol[]> {
    return featureRequest('workspace/symbol', { query }, normalizeWorkspaceSymbols, [])
  }

  function prepareRename(
    filePath: string,
    position: LspPosition,
  ): Promise<LspPrepareRename | null> {
    return atPosition(
      'textDocument/prepareRename',
      filePath,
      position,
      normalizePrepareRename,
      null,
    )
  }

  function rename(
    filePath: string,
    position: LspPosition,
    newName: string,
  ): Promise<LspWorkspaceEditFile[]> {
    return atPosition('textDocument/rename', filePath, position, normalizeWorkspaceEdit, [], {
      newName,
    })
  }

  function formatDocument(filePath: string, options: LspFormattingOptions): Promise<LspTextEdit[]> {
    // Respect the advertised capability — no provider → silent no-op, mirroring
    // how every other LSP feature degrades when the server doesn't support it.
    if (!ctx.capabilities?.documentFormattingProvider) return Promise.resolve([])
    return featureRequest(
      'textDocument/formatting',
      { textDocument: { uri: fileUri(filePath) }, options },
      normalizeTextEdits,
      [],
    )
  }

  function codeAction(
    filePath: string,
    range: LspRange,
    diagnostics: LspDiagnostic[],
    kinds: string[] = ['quickfix'],
    trigger: CodeActionTrigger = 'invoked',
  ): Promise<LspCodeAction[]> {
    // Respect the advertised capability — no provider → silent no-op (like format).
    if (!ctx.capabilities?.codeActionProvider) return Promise.resolve([])
    return featureRequest(
      'textDocument/codeAction',
      {
        textDocument: { uri: fileUri(filePath) },
        range,
        // `kinds` scopes the request (`context.only`) — quick-fix, source, refactor,
        // or a specific sub-kind like `source.organizeImports`. `diagnostics` are
        // the squiggles overlapping `range`. `triggerKind` is always sent: absent, a
        // server may treat the lightbulb's probe as a person asking (see `CodeActionTrigger`).
        context: {
          diagnostics,
          only: kinds,
          triggerKind:
            trigger === 'automatic' ? CODE_ACTION_TRIGGER_AUTOMATIC : CODE_ACTION_TRIGGER_INVOKED,
        },
      },
      (res) => normalizeCodeActions(res, kinds),
      [],
    )
  }

  // Resolve a lazy code action: echo the ORIGINAL action back (its `data` is
  // preserved between codeAction and resolve per spec) so the server can attach
  // the deferred WorkspaceEdit. Returns the enriched action (with `edit`) or null.
  function resolveCodeAction(action: LspCodeAction): Promise<LspCodeAction | null> {
    return featureRequest(
      'codeAction/resolve',
      { title: action.title, kind: action.kind, data: action.data },
      (res) => normalizeCodeActions([res])[0] ?? null,
      null,
    )
  }

  return {
    hover,
    completion,
    definition,
    references,
    implementation,
    typeDefinition,
    incomingCalls,
    outgoingCalls,
    documentHighlight,
    signatureHelp,
    inlayHint,
    documentColor,
    documentSymbols,
    workspaceSymbols,
    prepareRename,
    rename,
    formatDocument,
    codeAction,
    resolveCodeAction,
  }
}
