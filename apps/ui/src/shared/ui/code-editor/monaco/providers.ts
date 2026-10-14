import type * as Monaco from 'monaco-editor'
import type {
  ApplyCodeActionSource,
  CodeActionSource,
  CompletionSource,
  DocumentColorSource,
  DocumentHighlightSource,
  FormatSource,
  FormatTextSource,
  HoverSource,
  InlayHintSource,
  PrepareRenameSource,
  RenameSource,
  SignatureHelpSource,
  EditorDiagnostic,
  EditorPosition,
  EditorReference,
  EditorRenameResult,
} from '../types'
import type { StickySymbol } from '../stickyScroll'
import type { MonacoApi } from './runtime'
import { bufferEditMatches, monacoTextEdits } from './bufferEdits'
import {
  registerDefinitionNavigation,
  type DefinitionNavigationSources,
} from './definitionNavigation'

export interface MonacoProviderSources extends DefinitionNavigationSources {
  implementationSource?: (position: EditorPosition) => Promise<EditorReference[]>
  typeDefinitionSource?: (position: EditorPosition) => Promise<EditorReference[]>
  referencesSource?: (position: EditorPosition) => Promise<EditorReference[]>
  onLocationNavigate?: (location: { file: string; line: number; column?: number }) => void
  hoverSource?: HoverSource
  completionSource?: CompletionSource
  signatureHelpSource?: SignatureHelpSource
  documentHighlightSource?: DocumentHighlightSource
  inlayHintSource?: InlayHintSource
  documentColorSource?: DocumentColorSource
  prepareRenameSource?: PrepareRenameSource
  renameSource?: RenameSource
  onRenameApplied?: (result: EditorRenameResult) => void
  formatSource?: FormatSource
  formatText?: FormatTextSource
  codeActionSource?: CodeActionSource
  applyCodeActionSource?: ApplyCodeActionSource
  onCodeActionApplied?: (result: EditorRenameResult) => void
  diagnostics?: EditorDiagnostic[]
  onFixRequest?: (diagnostic: EditorDiagnostic) => void
  stickySymbols?: StickySymbol[]
}

const positionFromMonaco = (position: Monaco.Position) => ({
  line: position.lineNumber - 1,
  character: position.column - 1,
})

function rangeToMonaco(
  monaco: MonacoApi,
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  },
): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  )
}

function completionKind(monaco: MonacoApi, lspKind?: number): Monaco.languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind
  const map: Record<number, Monaco.languages.CompletionItemKind> = {
    1: kinds.Text,
    2: kinds.Method,
    3: kinds.Function,
    4: kinds.Constructor,
    5: kinds.Field,
    6: kinds.Variable,
    7: kinds.Class,
    8: kinds.Interface,
    9: kinds.Module,
    10: kinds.Property,
    11: kinds.Unit,
    12: kinds.Value,
    13: kinds.Enum,
    14: kinds.Keyword,
    15: kinds.Snippet,
    16: kinds.Color,
    17: kinds.File,
    18: kinds.Reference,
    19: kinds.Folder,
    20: kinds.EnumMember,
    21: kinds.Constant,
    22: kinds.Struct,
    23: kinds.Event,
    24: kinds.Operator,
    25: kinds.TypeParameter,
  }
  return map[lspKind ?? 0] ?? kinds.Text
}

export function registerMonacoProviders(options: {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  language: string
  getSources: () => MonacoProviderSources
  resolveDefinitionUri?: Parameters<typeof registerDefinitionNavigation>[0]['resolveDefinitionUri']
}): Monaco.IDisposable {
  const { monaco, editor, model, language, getSources, resolveDefinitionUri } = options
  const disposables: Monaco.IDisposable[] = []
  const owns = (candidate: Monaco.editor.ITextModel) => candidate === model

  disposables.push(
    registerDefinitionNavigation({
      monaco,
      editor,
      model,
      language,
      getSources,
      resolveDefinitionUri,
    }),
  )

  disposables.push(
    monaco.languages.registerDocumentSymbolProvider(language, {
      provideDocumentSymbols(candidate) {
        if (!owns(candidate)) return []
        return (getSources().stickySymbols ?? []).map((symbol) => {
          const start = Math.min(Math.max(symbol.line + 1, 1), candidate.getLineCount())
          const end = Math.min(Math.max(symbol.endLine + 1, start), candidate.getLineCount())
          return {
            name: symbol.name,
            detail: '',
            kind: monaco.languages.SymbolKind.Function,
            tags: [],
            range: new monaco.Range(start, 1, end, candidate.getLineMaxColumn(end)),
            selectionRange: new monaco.Range(start, 1, start, candidate.getLineMaxColumn(start)),
          }
        })
      },
    }),
    monaco.languages.registerHoverProvider(language, {
      async provideHover(candidate, position) {
        const source = getSources().hoverSource
        if (!source || !owns(candidate)) return null
        const hover = await source(positionFromMonaco(position))
        return hover ? { contents: [{ value: hover.value }] } : null
      },
    }),
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', '"', "'", '/', ':', '@'],
      async provideCompletionItems(candidate, position) {
        const source = getSources().completionSource
        if (!source || !owns(candidate)) return { suggestions: [] }
        const word = candidate.getWordUntilPosition(position)
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        )
        const items = await source(positionFromMonaco(position))
        return {
          suggestions: items.map((item) => {
            const insertText = item.insertText ?? item.label
            const isSnippet =
              item.insertTextFormat === 'snippet' ||
              (item.insertTextFormat === undefined && insertText.includes('$0'))
            return {
              label: item.label,
              detail: item.detail,
              documentation: item.documentation ? { value: item.documentation } : undefined,
              insertText,
              insertTextRules: isSnippet
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              kind: completionKind(monaco, item.kind),
              range: item.range ? rangeToMonaco(monaco, item.range) : range,
              filterText: item.filterText,
              sortText: item.sortText,
              preselect: item.preselect,
              commitCharacters: item.commitCharacters,
              command: item.command
                ? {
                    id: item.command.id,
                    title: item.command.title ?? item.label,
                    arguments: item.command.arguments,
                  }
                : undefined,
            }
          }),
        }
      },
    }),
    monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      async provideSignatureHelp(candidate, position) {
        const source = getSources().signatureHelpSource
        if (!source || !owns(candidate)) return null
        const help = await source(positionFromMonaco(position))
        if (!help) return null
        return {
          value: {
            activeParameter: help.activeParameter,
            activeSignature: help.activeSignature,
            signatures: help.signatures.map((signature) => ({
              label: signature.label,
              documentation: signature.documentation,
              parameters: signature.parameters.map((label) => ({ label })),
            })),
          },
          dispose() {},
        }
      },
    }),
    monaco.languages.registerDocumentHighlightProvider(language, {
      async provideDocumentHighlights(candidate, position) {
        const source = getSources().documentHighlightSource
        if (!source || !owns(candidate)) return []
        const highlights = await source(positionFromMonaco(position))
        return highlights.map((highlight) => ({
          range: rangeToMonaco(monaco, highlight.range),
          kind:
            highlight.kind === 3
              ? monaco.languages.DocumentHighlightKind.Write
              : highlight.kind === 2
                ? monaco.languages.DocumentHighlightKind.Read
                : monaco.languages.DocumentHighlightKind.Text,
        }))
      },
    }),
    monaco.languages.registerInlayHintsProvider(language, {
      async provideInlayHints(candidate, range) {
        const source = getSources().inlayHintSource
        if (!source || !owns(candidate)) return { hints: [], dispose() {} }
        const hints = await source({
          start: positionFromMonaco(range.getStartPosition()),
          end: positionFromMonaco(range.getEndPosition()),
        })
        return {
          hints: hints.map((hint) => ({
            position: new monaco.Position(hint.position.line + 1, hint.position.character + 1),
            label: hint.label,
            kind:
              hint.kind === 2
                ? monaco.languages.InlayHintKind.Parameter
                : monaco.languages.InlayHintKind.Type,
            paddingLeft: hint.paddingLeft,
            paddingRight: hint.paddingRight,
          })),
          dispose() {},
        }
      },
    }),
    monaco.languages.registerColorProvider(language, {
      async provideDocumentColors(candidate) {
        const source = getSources().documentColorSource
        if (!source || !owns(candidate)) return []
        const colors = await source()
        return colors.map((color) => ({
          range: rangeToMonaco(monaco, color.range),
          color: color.color,
        }))
      },
      provideColorPresentations(_candidate, color) {
        const { red, green, blue, alpha } = color.color
        const label = `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(
          blue * 255,
        )}, ${Number(alpha.toFixed(2))})`
        return [{ label }]
      },
    }),
  )

  if (getSources().prepareRenameSource && getSources().renameSource) {
    disposables.push(
      monaco.languages.registerRenameProvider(language, {
        async resolveRenameLocation(candidate, position) {
          const source = getSources().prepareRenameSource
          if (!source || !owns(candidate))
            return {
              range: new monaco.Range(1, 1, 1, 1),
              text: '',
              rejectReason: 'Rename unavailable',
            }
          const result = await source(positionFromMonaco(position))
          if (!result)
            return {
              range: new monaco.Range(1, 1, 1, 1),
              text: '',
              rejectReason: 'Symbol cannot be renamed',
            }
          const word = candidate.getWordAtPosition(position)
          const range = result.range
            ? rangeToMonaco(monaco, result.range)
            : new monaco.Range(
                position.lineNumber,
                word?.startColumn ?? position.column,
                position.lineNumber,
                word?.endColumn ?? position.column,
              )
          return { range, text: result.placeholder ?? candidate.getValueInRange(range) }
        },
        async provideRenameEdits(candidate, position, newName) {
          const source = getSources().renameSource
          if (!source || !owns(candidate)) return { edits: [], rejectReason: 'Rename unavailable' }
          const result = await source(positionFromMonaco(position), newName)
          getSources().onRenameApplied?.(result)
          return { edits: [] }
        },
      }),
    )
  }

  if (getSources().formatText || getSources().formatSource) {
    disposables.push(
      monaco.languages.registerDocumentFormattingEditProvider(language, {
        displayName: getSources().formatText ? 'Local formatter' : 'Language Server',
        async provideDocumentFormattingEdits(candidate) {
          if (!owns(candidate)) return []
          const sources = getSources()
          if (sources.formatText) {
            const current = candidate.getValue()
            const formatted = await sources.formatText(current)
            return formatted === current
              ? []
              : [{ range: candidate.getFullModelRange(), text: formatted }]
          }
          // Monaco applies the returned edits itself (one undo step, caret kept) and drops
          // them if the model changed meanwhile; the digest covers the other direction — a
          // server that answered for text this model no longer holds.
          const result = await sources.formatSource?.()
          if (!result || !bufferEditMatches(candidate, result)) return []
          return monacoTextEdits(monaco, result.edits)
        },
      }),
    )
  }

  const commandId = `localix.codeAction.${model.uri.toString()}`
  const agentFixCommandId = `localix.agentFix.${model.uri.toString()}`
  disposables.push(
    monaco.editor.registerCommand(
      commandId,
      (
        _accessor,
        action: Parameters<NonNullable<MonacoProviderSources['applyCodeActionSource']>>[0],
      ) => {
        const apply = getSources().applyCodeActionSource
        if (!apply) return
        void apply(action).then((result) => getSources().onCodeActionApplied?.(result))
      },
    ),
    monaco.editor.registerCommand(agentFixCommandId, (_accessor, diagnostic: EditorDiagnostic) =>
      getSources().onFixRequest?.(diagnostic),
    ),
  )
  if (
    (getSources().codeActionSource && getSources().applyCodeActionSource) ||
    getSources().onFixRequest
  ) {
    const hasLanguageServerActions = Boolean(
      getSources().codeActionSource && getSources().applyCodeActionSource,
    )
    disposables.push(
      monaco.languages.registerCodeActionProvider(
        language,
        {
          async provideCodeActions(candidate, range, context) {
            if (!owns(candidate)) return { actions: [], dispose() {} }
            const sources = getSources()
            const lspActions = sources.codeActionSource
              ? await sources.codeActionSource(
                  {
                    start: positionFromMonaco(range.getStartPosition()),
                    end: positionFromMonaco(range.getEndPosition()),
                  },
                  context.only ? [context.only] : undefined,
                  // Monaco probes on every caret move for the lightbulb (`Auto`); only a
                  // lightbulb click or Cmd+. is the person asking (`Invoke`).
                  context.trigger === monaco.languages.CodeActionTriggerType.Auto
                    ? 'automatic'
                    : 'invoked',
                )
              : []
            const actions: Monaco.languages.CodeAction[] = lspActions.map((action) => ({
              title: action.title,
              kind: action.kind,
              isPreferred: action.isPreferred,
              command: { id: commandId, title: action.title, arguments: [action] },
            }))

            const marker = context.markers[0]
            const diagnostic =
              marker &&
              sources.diagnostics?.find((item) => {
                const startLine = item.line + 1
                const endLine = item.endLine + 1
                return (
                  item.message === marker.message &&
                  startLine === marker.startLineNumber &&
                  endLine === marker.endLineNumber
                )
              })
            if (
              marker &&
              diagnostic &&
              sources.onFixRequest &&
              (context.only?.startsWith('quickfix') ?? true)
            ) {
              actions.push({
                title: 'Fix with Agent',
                kind: 'quickfix.localix.agent',
                isAI: true,
                diagnostics: [marker],
                command: {
                  id: agentFixCommandId,
                  title: 'Fix with Agent',
                  arguments: [diagnostic],
                },
              })
            }
            return {
              actions,
              dispose() {},
            }
          },
        },
        {
          providedCodeActionKinds: hasLanguageServerActions
            ? ['quickfix', 'refactor', 'source']
            : ['quickfix'],
        },
      ),
    )
  }

  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose()
    },
  }
}
