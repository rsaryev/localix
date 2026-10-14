import { diagnosticsOverlappingRange } from './lsp-normalize-diagnostics'
import type {
  LspClientInfo,
  LspDiagnostic,
  LspCompletionItem,
  LspLocation,
  LspDocumentHighlight,
  LspInlayHint,
  LspColorInfo,
  LspDocumentSymbol,
  LspPrepareRename,
  LspWorkspaceEditFile,
  LspTextEdit,
  LspCodeAction,
} from './lsp-protocol'
import type { LspManager } from './lsp-manager-types'

/** Query a file's ready client, with the manager owning startup and idle eviction. */
type ReadyClientQuery = <T>(
  filePath: string,
  projectRoot: string,
  fallback: T,
  call: (client: LspClientInfo) => Promise<T>,
) => Promise<T>

type ManagerQueries = Pick<
  LspManager,
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
  | 'prepareRename'
  | 'rename'
  | 'formatDocument'
  | 'codeAction'
  | 'resolveCodeAction'
>

export function createLspManagerQueries(
  withReadyClient: ReadyClientQuery,
  collectDiagnostics: (projectRoot: string) => Record<string, LspDiagnostic[]>,
): ManagerQueries {
  return {
    hover(projectRoot, filePath, position) {
      return withReadyClient(filePath, projectRoot, null, (c) => c.hover(filePath, position))
    },

    completion(projectRoot, filePath, position) {
      return withReadyClient<LspCompletionItem[]>(filePath, projectRoot, [], (c) =>
        c.completion(filePath, position),
      )
    },

    definition(projectRoot, filePath, position) {
      return withReadyClient<LspLocation[]>(filePath, projectRoot, [], (c) =>
        c.definition(filePath, position),
      )
    },

    references(projectRoot, filePath, position) {
      return withReadyClient<LspLocation[]>(filePath, projectRoot, [], (c) =>
        c.references(filePath, position),
      )
    },

    implementation(projectRoot, filePath, position) {
      return withReadyClient<LspLocation[]>(filePath, projectRoot, [], (c) =>
        c.implementation(filePath, position),
      )
    },

    typeDefinition(projectRoot, filePath, position) {
      return withReadyClient<LspLocation[]>(filePath, projectRoot, [], (c) =>
        c.typeDefinition(filePath, position),
      )
    },

    incomingCalls(projectRoot, filePath, position) {
      return withReadyClient<LspLocation[]>(filePath, projectRoot, [], (c) =>
        c.incomingCalls(filePath, position),
      )
    },

    outgoingCalls(projectRoot, filePath, position) {
      return withReadyClient<LspLocation[]>(filePath, projectRoot, [], (c) =>
        c.outgoingCalls(filePath, position),
      )
    },

    documentHighlight(projectRoot, filePath, position) {
      return withReadyClient<LspDocumentHighlight[]>(filePath, projectRoot, [], (c) =>
        c.documentHighlight(filePath, position),
      )
    },

    signatureHelp(projectRoot, filePath, position) {
      return withReadyClient(filePath, projectRoot, null, (c) =>
        c.signatureHelp(filePath, position),
      )
    },

    inlayHint(projectRoot, filePath, range) {
      return withReadyClient<LspInlayHint[]>(filePath, projectRoot, [], (c) =>
        c.inlayHint(filePath, range),
      )
    },

    documentColor(projectRoot, filePath) {
      return withReadyClient<LspColorInfo[]>(filePath, projectRoot, [], (c) =>
        c.documentColor(filePath),
      )
    },

    documentSymbols(projectRoot, filePath) {
      return withReadyClient<LspDocumentSymbol[]>(filePath, projectRoot, [], (c) =>
        c.documentSymbols(filePath),
      )
    },

    prepareRename(projectRoot, filePath, position) {
      return withReadyClient<LspPrepareRename | null>(filePath, projectRoot, null, (c) =>
        c.prepareRename(filePath, position),
      )
    },

    rename(projectRoot, filePath, position, newName) {
      return withReadyClient<LspWorkspaceEditFile[]>(filePath, projectRoot, [], (c) =>
        c.rename(filePath, position, newName),
      )
    },

    formatDocument(projectRoot, filePath, options) {
      return withReadyClient<LspTextEdit[]>(filePath, projectRoot, [], (c) =>
        c.formatDocument(filePath, options),
      )
    },

    codeAction(projectRoot, filePath, range, kinds, trigger) {
      // The context.diagnostics are the file's cached squiggles overlapping the
      // request range — the exact same diagnostics the editor is showing there.
      const diagnostics = diagnosticsOverlappingRange(
        collectDiagnostics(projectRoot)[filePath] ?? [],
        range,
      )
      return withReadyClient<LspCodeAction[]>(filePath, projectRoot, [], (c) =>
        c.codeAction(filePath, range, diagnostics, kinds, trigger),
      )
    },

    resolveCodeAction(projectRoot, filePath, action) {
      return withReadyClient<LspCodeAction | null>(filePath, projectRoot, null, (c) =>
        c.resolveCodeAction(action),
      )
    },
  }
}
