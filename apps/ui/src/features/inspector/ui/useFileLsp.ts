import { useCallback, useRef } from 'react'
import { backendClient } from '@/shared/api/client'
import type {
  EditorPosition,
  EditorCodeAction,
  NextEditRequest,
  EditorSuggestion,
} from '@/shared/ui/code-editor/CodeEditor'
import type { LspCodeAction } from '@/shared/api/contracts'
import { languageFromPath } from '@/shared/ui/diff'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { isModelRoutingTaskEnabled } from '@localixai/api/model-task-catalog'
import type { CompletionReference } from '@localixai/api/client'
import { completionWorkingSet } from '@/shared/api/completionWorkingSet'
import { getFileEditHistory } from '../model/editorActivity'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'

/** An editor host's own anchors (a SQL statement's tables) — the shape every surface sends. */
export type NextEditContextSource = (request: NextEditRequest) => CompletionReference[]

/**
 * The LSP language-feature providers the editor calls (hover, completion,
 * signature help, definition, references), all wired to the backend over the
 * realtime socket and keyed by the resolved absolute path. They no-op (resolve
 * empty) until a session + open file exist. `flushDocument` sends the live buffer
 * to the language server when it is ahead, and runs before every request.
 */
export function useFileLsp(
  sessionId: string | null | undefined,
  editPath: string,
  nextEditContextSource?: NextEditContextSource,
  flushDocument?: () => void,
) {
  const workItemVisible = useWorkItemVisible()
  const { settings } = useUserSettings()
  const nextEditEnabled = isModelRoutingTaskEnabled(settings.agentSettings, 'inlineCompletion')
  // Whether a contributed per-line-authorship source may run at all. The setting is the editor's
  // (it governs a gutter the editor draws); who can answer it is not.
  const lineAuthorshipEnabled = settings.agentSettings?.gitBlame?.enabled ?? true
  // Scrollbar overview-ruler markers — default ON (passive visual aid).
  const scrollbarMarkersEnabled = settings.agentSettings?.editorScrollbarMarkers?.enabled ?? true
  // Bracket-pair colorization ("rainbow brackets") — default ON (passive visual aid).
  const bracketColorizationEnabled =
    settings.agentSettings?.bracketPairColorization?.enabled ?? true
  // Format-on-save — run the
  // LSP formatter on the buffer at save time. Default ON.
  const formatOnSaveEnabled = settings.agentSettings?.editorSave?.formatOnSave ?? true
  // Every request below is answered against the document the language server holds. The
  // buffer reaches it on a short debounce (`useFileEditor`), so a completion asked for in the
  // same tick as the keystroke that triggered it was answered for the text BEFORE that
  // keystroke. `ask` sends the buffer first when it is ahead — the socket keeps the two in
  // order and the server's sync barrier holds the request behind the change.
  const flushRef = useRef(flushDocument)
  flushRef.current = flushDocument
  const ask = useCallback(
    <T>(fallback: T, run: (session: string, file: string) => Promise<T>): Promise<T> => {
      if (!sessionId || !editPath) return Promise.resolve(fallback)
      flushRef.current?.()
      return run(sessionId, editPath)
    },
    [sessionId, editPath],
  )
  const hoverSource = useCallback(
    (pos: EditorPosition) => ask(null, (s, f) => backendClient.lspHover(s, f, pos)),
    [ask],
  )
  const completionSource = useCallback(
    (pos: EditorPosition) => ask([], (s, f) => backendClient.lspCompletion(s, f, pos)),
    [ask],
  )
  const signatureHelpSource = useCallback(
    (pos: EditorPosition) => ask(null, (s, f) => backendClient.lspSignatureHelp(s, f, pos)),
    [ask],
  )
  const definitionSource = useCallback(
    (pos: EditorPosition) => ask([], (s, f) => backendClient.lspDefinition(s, f, pos)),
    [ask],
  )
  const definitionTargetSource = useCallback(
    async (file: string, signal: AbortSignal) => {
      if (!sessionId) return null
      const target = await backendClient.getFileContent(sessionId, file, { full: true, signal })
      if (target.truncated || target.encoding === 'base64') return null
      return { content: target.content, language: languageFromPath(target.path || file) }
    },
    [sessionId],
  )
  const implementationSource = useCallback(
    (pos: EditorPosition) => ask([], (s, f) => backendClient.lspImplementation(s, f, pos)),
    [ask],
  )
  const typeDefinitionSource = useCallback(
    (pos: EditorPosition) => ask([], (s, f) => backendClient.lspTypeDefinition(s, f, pos)),
    [ask],
  )
  const referencesSource = useCallback(
    (pos: EditorPosition) => ask([], (s, f) => backendClient.lspReferences(s, f, pos)),
    [ask],
  )
  const documentHighlightSource = useCallback(
    (pos: EditorPosition) => ask([], (s, f) => backendClient.lspDocumentHighlight(s, f, pos)),
    [ask],
  )
  const inlayHintSource = useCallback(
    (range: { start: EditorPosition; end: EditorPosition }) =>
      ask([], (s, f) => backendClient.lspInlayHint(s, f, range)),
    [ask],
  )
  const documentColorSource = useCallback(
    () => ask([], (s, f) => backendClient.lspDocumentColor(s, f)),
    [ask],
  )
  const prepareRenameSource = useCallback(
    (pos: EditorPosition) => ask(null, (s, f) => backendClient.lspPrepareRename(s, f, pos)),
    [ask],
  )
  const renameSource = useCallback(
    (pos: EditorPosition, newName: string) =>
      ask({ changedFiles: [], files: [] }, (s, f) => backendClient.lspRename(s, f, pos, newName)),
    [ask],
  )
  const formatSource = useCallback(
    () =>
      ask(null, (s, f) =>
        backendClient.lspFormatDocument(s, f, { tabSize: 2, insertSpaces: true }),
      ),
    [ask],
  )
  const codeActionSource = useCallback(
    (
      range: { start: EditorPosition; end: EditorPosition },
      kinds?: string[],
      trigger?: 'invoked' | 'automatic',
    ): Promise<EditorCodeAction[]> =>
      ask([], (s, f) => backendClient.lspCodeAction(s, f, range, kinds, trigger)),
    [ask],
  )
  const applyCodeActionSource = useCallback(
    (action: EditorCodeAction) =>
      // The action round-trips verbatim — it IS the LspCodeAction the server sent.
      ask({ changedFiles: [], files: [] }, (s, f) =>
        backendClient.lspApplyCodeAction(s, f, action as unknown as LspCodeAction),
      ),
    [ask],
  )

  // Edit prediction — the ONE editor-prediction experience.
  // Disabled → undefined source (no request ever fires). Enabled → send the whole
  // open file + cursor line/column + this file's recent edit windows. The backend
  // proposes a small SAME-FILE diff; optional context arrives only through explicit
  // opaque Context Fabric references.
  const nextEditSource = useCallback(
    async (req: NextEditRequest, signal: AbortSignal): Promise<EditorSuggestion[] | null> => {
      if (!sessionId || !editPath) return null
      // SAME-FILE ONLY: current file + cursor + this file's recent edit history.
      const result = await backendClient.predictNextEdit(
        sessionId,
        {
          file: editPath,
          content: req.content,
          cursorLine: req.cursorLine,
          cursorColumn: req.cursorColumn,
          requestId: req.requestId,
          documentVersion: req.documentVersion,
          documentDigest: req.documentDigest,
          language: languageFromPath(editPath),
          recentlyEditedRanges: getFileEditHistory(editPath),
          // The host's anchors rank as linked; what else is open rides as the shared working
          // set, minus this file — which the prompt already carries whole.
          contextReferences: [
            ...(nextEditContextSource?.(req) ?? []).map((reference) => ({
              ...reference,
              origin: 'linked' as const,
            })),
            ...completionWorkingSet({ excludeFilePath: editPath }),
          ],
        },
        signal,
      )
      if (signal.aborted) throw new DOMException('Cancelled prediction', 'AbortError')
      if (result.outcome !== 'predicted') {
        if (result.diagnostic.code === 'empty' && result.diagnostic.outcome === 'empty') return null
        throw new Error(
          result.diagnostic.code === 'empty' ? result.diagnostic.outcome : 'stale_delivery',
        )
      }
      return result.edits.map((edit, i) => ({
        // Unique per hunk — Apply/Reject route on the `next-edit` prefix.
        id: `next-edit:${i}`,
        kind: 'suggestion' as const,
        source: 'edit-prediction' as const,
        startLine: edit.startLine,
        endLine: edit.endLine,
        original: edit.original,
        replacement: edit.replacement,
      }))
    },
    [sessionId, editPath, nextEditContextSource],
  )

  return {
    /** Whether a contributed per-line-authorship gutter may render for this file. */
    lineAuthorshipEnabled: workItemVisible && lineAuthorshipEnabled,
    hoverSource: workItemVisible ? hoverSource : undefined,
    completionSource: workItemVisible ? completionSource : undefined,
    signatureHelpSource: workItemVisible ? signatureHelpSource : undefined,
    nextEditSource: workItemVisible && nextEditEnabled ? nextEditSource : undefined,
    scrollbarMarkersEnabled,
    bracketColorizationEnabled,
    formatOnSaveEnabled,
    definitionSource: workItemVisible ? definitionSource : undefined,
    definitionTargetSource: workItemVisible ? definitionTargetSource : undefined,
    implementationSource: workItemVisible ? implementationSource : undefined,
    typeDefinitionSource: workItemVisible ? typeDefinitionSource : undefined,
    referencesSource: workItemVisible ? referencesSource : undefined,
    documentHighlightSource: workItemVisible ? documentHighlightSource : undefined,
    inlayHintSource: workItemVisible ? inlayHintSource : undefined,
    documentColorSource: workItemVisible ? documentColorSource : undefined,
    prepareRenameSource: workItemVisible ? prepareRenameSource : undefined,
    renameSource: workItemVisible ? renameSource : undefined,
    // Autosave deliberately survives a tab switch and may need the formatter while
    // hidden; useFileEditor closes the LSP document again after that save settles.
    formatSource,
    codeActionSource: workItemVisible ? codeActionSource : undefined,
    applyCodeActionSource: workItemVisible ? applyCodeActionSource : undefined,
  }
}
