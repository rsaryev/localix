import {
  CODE_ACTION_TRIGGER_AUTOMATIC,
  CODE_ACTION_TRIGGER_INVOKED,
  fileUri,
  normalizeCodeActions,
  normalizePrepareRename,
  normalizeTextEdits,
  normalizeWorkspaceEdit,
} from './lsp-protocol'
import type {
  CodeActionTrigger,
  LspCodeAction,
  LspDiagnostic,
  LspFormattingOptions,
  LspPosition,
  LspPrepareRename,
  LspRange,
  LspTextEdit,
  LspWorkspaceEditFile,
} from './lsp-response-types'
import type { LspClientInfo, ServerCapabilities } from './lsp-client-contract'

interface EditorMutationPorts {
  getCapabilities(): ServerCapabilities | undefined
  featureRequest<T>(
    method: string,
    params: Record<string, unknown>,
    normalize: (response: unknown) => T,
    onError: T,
  ): Promise<T>
  atPosition<T>(
    method: string,
    filePath: string,
    position: LspPosition,
    normalize: (response: unknown) => T,
    onError: T,
    extraParams?: Record<string, unknown>,
  ): Promise<T>
}

/** Prepare editor changes through the shared request transport. */
export function createEditorMutations({
  getCapabilities,
  featureRequest,
  atPosition,
}: EditorMutationPorts): Pick<
  LspClientInfo,
  'prepareRename' | 'rename' | 'formatDocument' | 'codeAction' | 'resolveCodeAction'
> {
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
    if (!getCapabilities()?.documentFormattingProvider) return Promise.resolve([])
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
    if (!getCapabilities()?.codeActionProvider) return Promise.resolve([])
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

  return { prepareRename, rename, formatDocument, codeAction, resolveCodeAction }
}
