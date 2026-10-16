/**
 * The static `initialize` client capabilities — pure declarative protocol config
 * the handshake advertises to EVERY server (never per-server, never TS-specific).
 *
 * It is DATA, not logic: what the editor can render, not how the client behaves.
 * Kept out of lsp-client.ts so the connection/handshake/diagnostics flow there
 * reads as flow, and so adding a capability is a one-line edit to a table rather
 * than a diff inside a 500-line factory.
 */
export const CLIENT_CAPABILITIES = {
  window: {
    workDoneProgress: true,
  },
  textDocument: {
    synchronization: {
      dynamicRegistration: false,
      willSave: false,
      willSaveWaitUntil: false,
      didSave: true,
    },
    publishDiagnostics: {
      relatedInformation: true,
      versionSupport: true,
      // Unnecessary (1) + Deprecated (2): the editor fades unused code and strikes through
      // deprecated uses. Servers that honour the capability only send tags when asked.
      tagSupport: { valueSet: [1, 2] },
    },
    diagnostic: {
      dynamicRegistration: true,
      relatedDocumentSupport: true,
    },
    // Editor intelligence (inspector editor): hover type info + completion.
    // definition is advertised too so go-to-definition (roadmap) needs no
    // re-handshake. All resolved generically per server — never TS-specific.
    hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
    completion: {
      dynamicRegistration: false,
      completionItem: {
        snippetSupport: false,
        documentationFormat: ['markdown', 'plaintext'],
      },
    },
    definition: { dynamicRegistration: false, linkSupport: true },
    references: { dynamicRegistration: false },
    // Go-to-implementation (interfaces/abstract methods → concrete impls) — advertised
    // so servers respond; resolved generically like definition, never TS-specific.
    implementation: { dynamicRegistration: false, linkSupport: true },
    // Go-to-type-definition (a value → the declaration of its TYPE) — advertised so
    // servers respond; resolved generically like implementation, never TS-specific.
    typeDefinition: { dynamicRegistration: false, linkSupport: true },
    // Call hierarchy — servers only answer prepareCallHierarchy/incomingCalls when
    // the client advertises support. Backs code_nav's "who calls this".
    callHierarchy: { dynamicRegistration: false },
    // Occurrence highlighting — the symbol under the cursor lit up across the file.
    documentHighlight: { dynamicRegistration: false },
    // Inline inlay hints (inferred types / parameter names). resolveSupport is
    // omitted — we request already-resolved labels for the visible range only.
    inlayHint: { dynamicRegistration: false },
    // Document color literals → editor swatch decorations (CSS/HTML servers).
    colorProvider: { dynamicRegistration: false },
    // Rename + prepareRename so go-to-rename (F2) works; prepareSupport lets the
    // server return the symbol span + placeholder before the rename is committed.
    rename: { dynamicRegistration: false, prepareSupport: true },
    // Code actions (quick-fix lightbulb). codeActionLiteralSupport lets the server
    // return rich `CodeAction` literals (not just `Command`s); dataSupport +
    // resolveSupport.properties:['edit'] let servers (vtsls/tsserver) defer the
    // WorkspaceEdit until we ask via codeAction/resolve. Advertised for ALL servers.
    codeAction: {
      dynamicRegistration: false,
      codeActionLiteralSupport: {
        codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ['edit'] },
    },
  },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    // Project-wide symbol search (workspace/symbol) for the ⌘T palette.
    symbol: { dynamicRegistration: false },
    didChangeWatchedFiles: { dynamicRegistration: false },
    diagnostics: {
      // We DO support refresh: pull-based servers (vscode-json/css) often return
      // an empty report on the first pull right after didOpen and then signal
      // `workspace/diagnostic/refresh` once analysis settles. Advertising support
      // lets the server tell us to re-pull — without it those diagnostics never
      // arrive (the file shows no squiggles). The handler below re-pulls.
      refreshSupport: true,
    },
  },
} as const
