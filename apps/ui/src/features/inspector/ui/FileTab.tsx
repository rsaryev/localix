import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Kbd } from '@localixai/kit/kbd'
import { FileText, FileX2, TriangleAlert, WandSparkles } from 'lucide-react'
import { useChatStore } from '@/features/chat/model/store'
import { FileEditorEnhancements } from '@/shared/contrib/FileEditorEnhancements'
import type { FileHistoryEnhancement } from '@/shared/ui/code-editor/fileEnhancement'
import { openFileInGrid } from '@/features/inspector/model/fileNav'
import { useGridStore } from '@/features/workspace-grid/model'
import { recordEdit } from '@/features/inspector/model/editorActivity'
import {
  editorViewKey,
  loadEditorViewState,
  saveEditorViewState,
} from '@/features/inspector/model/editorViewState'
import type { ViewStateBridge } from '@/shared/ui/code-editor/viewState'
import {
  CodeEditor,
  type EditorDiagnostic,
  type EditorCursorStatus,
  type EditorPosition,
  type EditorCompletionItem,
  type CompletionSource,
  type FormatTextSource,
  type EditorTextSelection,
  type EditorContentChange,
  type EditorSuggestion,
  type EditorRenameResult,
} from '@/shared/ui/code-editor/CodeEditor'
import { primaryChangeLine } from '@/shared/ui/code-editor/contentSync'
import { openPreviewFromClick } from '../model/openPreview'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import { STREAM_MARKDOWN_REPARSE_MS, useStreamingThrottle } from '@/shared/ui/useStreamingThrottle'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { ProblemLine } from '@/shared/ui/problem-report'
import { languageFromPath } from '@/shared/ui/diff'
import { looksBinary } from '@/shared/lib/looksBinary'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import { useActiveEditorSave } from '@/shared/lib/activeEditorBus'
import { isHtml, isMarkdown, toEditorDiagnostic } from './fileTabHelpers'
import { contentTypeForPath, isOpenExternallyType } from '@/shared/lib/contentTypeRouting'
import { useFileLsp, type NextEditContextSource } from './useFileLsp'
import { useSplitScrollSync } from './useSplitScrollSync'
import { useFileComments } from './useFileComments'
import { useFileEditor, type FormatOnSaveRunner } from './useFileEditor'
import { settleLspEdit, type LspEditVerb } from '../model/lspEditResult'
import { applyTextEdits, textDigest } from '@localixai/api/lsp-edits'
import { FileImageView } from './FileImageView'
import { FileReadonlyView } from './FileReadonlyView'
import { useSymbolBreadcrumb } from './useSymbolBreadcrumb'
import { SymbolBreadcrumbBar } from './SymbolBreadcrumbBar'
import { FileEditorToolbar } from './FileEditorToolbar'
import { EditorStatusBar } from './EditorStatusBar'
import { PeekDefinitionPanel } from './PeekDefinitionPanel'
import { usePeekDefinition, type PeekTarget } from './usePeekDefinition'
import type { MonacoEditorExtension } from '@/shared/ui/code-editor/monaco/extensions'
import { mergeConflictExtension } from './mergeConflictExtension'
import { MergeConflictBar } from './MergeConflictBar'
import { useMergeConflicts } from '../model/useMergeConflicts'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { useWorkItemFocused } from '@localixai/kit/work-item-focus'
import { WorkbenchStatusContribution } from '@localixai/kit/workbench-statusbar'
import { snippetMessageBindingDraft, type PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { fileSelectionMessageBinding } from '../model/selectionContext'
import { editorStateMessageBinding } from '../model/editorStateContext'

interface FileTabProps {
  /** The grid WorkItem id backing this tab — reported to the grid store so an
   *  unsaved buffer shows a dirty dot on the tab. Omitted → no dot (e.g. previews). */
  itemId?: string
  path: string
  /** The session this file tab BELONGS to (its grid scope). Bind file I/O / LSP /
   *  diagnostics to it, not the globally-active session — with warm keep-alive a
   *  background session's file tab is mounted (hidden), and reading the active
   *  session would fetch/save against the WRONG workspace. Required: a caller with no
   *  session has no workspace to open a file from, and renders no file tab. */
  sessionId: string
  /** 1-indexed line to scroll to once loaded (from a `path:line` link). */
  line?: number
  /** 0-based start character within `line` — places the cursor on the exact token
   *  (e.g. a diagnostic's position) instead of the line start. */
  column?: number
  /** 1-indexed end line + 0-based end character; when present the editor selects
   *  [start, end] (e.g. a diagnostic's exact range) rather than only the cursor. */
  endLine?: number
  endColumn?: number
  /** Monotonic nonce that changes on every open request, so re-opening the same
   *  path+line still re-reveals (scroll + flash). */
  revealAt?: number
  /** Extra completion provider merged AHEAD of the LSP one, given the live document
   *  text + position — used to layer schema-aware SQL autocomplete onto a .sql file.
   *  (The host injects the live buffer, so the source stays a pure text→items fn.) */
  auxCompletionSource?: (
    text: string,
    pos: EditorPosition,
  ) => EditorCompletionItem[] | Promise<EditorCompletionItem[]>
  /** Opaque domain-resource references resolved server-side for edit prediction. */
  nextEditContextSource?: NextEditContextSource
  /** A panel docked below the editor (e.g. the SQL run bar + results for a .sql file). */
  bottomPanel?: React.ReactNode
  /** Fired on ⌘/Ctrl+Enter in the editor with the current run context (used to run the
   *  SQL statement under the cursor). */
  onRun?: (ctx: EditorRunContext) => void
  /** Called once with a getter for the current editor run context, so a docked panel's
   *  own Run button can trigger the same run as the ⌘/Ctrl+Enter shortcut. */
  bindRunContext?: (get: () => EditorRunContext) => void
  /** Extra mount-time Monaco extensions (e.g. the SQL active-statement highlight on a
   *  .sql file). Pass a stable value — applied once at mount. */
  extensions?: MonacoEditorExtension[]
  /** Optional in-memory formatter contributed by a specialized file editor. */
  formatText?: FormatTextSource
  /** Host-owned live-context publisher scoped to this file tab. */
  publishMessageContext?: PublishMessageContext
}

type SessionFileTabProps = FileTabProps & {
  /** File-history adornments from whatever claims this path — empty when nothing does. */
  enhancement: FileHistoryEnhancement
}

/** The editor state a Run action needs: the whole document, the current selection, and
 *  the caret offset (to resolve the statement under the cursor). */
export interface EditorRunContext {
  fullText: string
  selectedText: string
  cursorOffset: number
  /** Run Monaco's native Format Document command for this editor. */
  formatDocument: () => Promise<void>
}

/**
 * Rename (F2) and a quick-fix end the same way wherever they were asked from — see
 * `settleLspEdit`. Format needs no handler: Monaco applies the formatter's buffer edits itself.
 *
 * Closes over nothing, so it lives out here rather than being rebuilt per render — and
 * CodeEditor reads these through a per-render props ref, so its identity is free.
 */
const lspEditSettled = (verb: LspEditVerb) => (result: EditorRenameResult) => {
  settleLspEdit(result, verb)
}

/**
 * Inspector file panel. Editable text files open directly in the Monaco editor
 * (LSP squiggles + hover + autocomplete); images, binaries, and over-large files
 * fall back to the read-only viewer. Markdown opens in the editor with a rendered
 * Preview toggle.
 */
export function FileTab(props: FileTabProps) {
  // A tab with no session used to borrow the chat on screen, so a background file tab read, saved
  // and linted against whichever workspace the person had switched to. The session is now the
  // caller's, always. The key remounts the editor state machine at that boundary so an old
  // buffer, baseHash, conflict or in-flight save can never retarget another session.
  //
  // The enhancer chain sits OUTSIDE that key on purpose: an enhancer contributes hooks scoped to
  // (session, path) as well, and one that survived the boundary would answer the new file with the
  // previous file's history.
  return (
    <FileEditorEnhancements {...props}>
      {(enhancement) => (
        <SessionFileTab
          key={`${props.sessionId}\u0000${props.path}`}
          {...props}
          enhancement={enhancement}
        />
      )}
    </FileEditorEnhancements>
  )
}

function SessionFileTab({
  itemId,
  path,
  line,
  column,
  endLine,
  endColumn,
  revealAt,
  sessionId,
  auxCompletionSource,
  nextEditContextSource,
  bottomPanel,
  onRun,
  bindRunContext,
  extensions,
  formatText,
  publishMessageContext,
  enhancement,
}: SessionFileTabProps) {
  const workItemVisible = useWorkItemVisible()
  // Only the focused group's active editor publishes into the app status bar —
  // a side-by-side split must not contribute twice (only the active
  // group's status shows).
  const workItemFocused = useWorkItemFocused()
  // Persist + restore this file's caret + scroll across a tab reopen / reload.
  // Keyed per session+path (like the grid keys the tab), so the same path in two
  // sessions restores independently. An explicit path:line reveal opts out.
  const viewStateBridge = useMemo<ViewStateBridge>(() => {
    const key = editorViewKey(sessionId, path)
    return {
      load: () => loadEditorViewState(key),
      save: (snap) => saveEditorViewState(key, snap),
      skipRestore: () => Boolean(line),
    }
  }, [sessionId, path, line])

  // Format-on-save runner. Populated below once the
  // LSP `formatSource` + the setting are resolved; `useFileEditor.save()` reads it
  // via this ref (formatSource depends on editPath, which useFileEditor produces —
  // so the value is threaded through a ref rather than an argument). Null → off.
  const formatOnSaveRef = useRef<FormatOnSaveRunner | null>(null)

  // Load + edit-buffer state machine (full-file fetch, optimistic save, debounced
  // LSP didChange sync, markdown preview toggle). See useFileEditor.
  const {
    state,
    buffer,
    setBuffer,
    flushLspSync,
    baseHash,
    editPath,
    dirty,
    saving,
    problem,
    conflict,
    externalChanges,
    overwrite,
    reloadFromDisk,
    compareWithDisk,
    previewMarkdown,
    togglePreview,
    save,
  } = useFileEditor(sessionId, path, formatOnSaveRef)

  // Surface the unsaved-buffer state on the grid tab (dirty dot). Clear on unmount
  // so a closed/remounted tab never leaves a stale dot behind.
  useEffect(() => {
    if (!itemId) return
    useGridStore.getState().setItemDirty(itemId, dirty)
    return () => {
      useGridStore.getState().setItemDirty(itemId, false)
    }
  }, [itemId, dirty])

  const onEditorFocus = useActiveEditorSave(() => void save())

  // Live LSP diagnostics for the open file, delivered via the `lsp.diagnostics`
  // firehose event into the session store (keyed by the resolved absolute path).
  const rawDiagnostics = useChatStore((s) => {
    if (!editPath) return undefined
    const sess = s.allSessions.find((x) => x.id === sessionId)
    return sess?.lspDiagnostics[editPath]
  })
  const diagnostics = useMemo<EditorDiagnostic[]>(
    () => (rawDiagnostics ? rawDiagnostics.map(toEditorDiagnostic) : []),
    [rawDiagnostics],
  )

  // Language-feature providers (hover/completion/signature/definition/references)
  // wired to the backend LSP over the realtime socket, keyed by the resolved path.
  const {
    hoverSource,
    completionSource,
    signatureHelpSource,
    definitionSource,
    definitionTargetSource,
    implementationSource,
    typeDefinitionSource,
    referencesSource,
    documentHighlightSource,
    inlayHintSource,
    documentColorSource,
    prepareRenameSource,
    renameSource,
    formatSource,
    codeActionSource,
    applyCodeActionSource,
    nextEditSource,
    lineAuthorshipEnabled,
    scrollbarMarkersEnabled,
    bracketColorizationEnabled,
    formatOnSaveEnabled,
  } = useFileLsp(sessionId, editPath, nextEditContextSource, flushLspSync)

  // Keep the format-on-save runner current. When enabled, it asks the LSP formatter for
  // edits to the buffer being saved and applies them in memory, so the save writes the
  // formatted text ONCE. Edits computed for any other text (the digest disagrees) are
  // ignored rather than spliced in. Any miss/error resolves null so the save falls
  // through to the text-cleaned buffer. Disabled → null (no request ever fires).
  useEffect(() => {
    formatOnSaveRef.current = formatOnSaveEnabled
      ? async (text) => {
          try {
            const edit = await formatSource()
            return edit && edit.digest === textDigest(text)
              ? applyTextEdits(text, edit.edits)
              : null
          } catch {
            return null
          }
        }
      : null
  }, [formatOnSaveEnabled, formatSource])

  // Breadcrumb symbol (the enclosing function/class at the cursor). Re-derives
  // after buffer edits settle and on each successful save (ranges may move).
  // Declared before the suggestion inbox so its imperative editor handle is in scope
  // for the ephemeral Apply paths.
  const { symbolPath, docSymbols, setCursorLine, editorApiRef } = useSymbolBreadcrumb(
    sessionId,
    editPath,
    baseHash,
    buffer,
  )

  const [nextEdits, setNextEdits] = useState<EditorSuggestion[] | null>(null)

  // Quick-diff gutter: contributed. The editor knows a feed of changed line ranges, a hunk to
  // preview and a way to revert one — never what the file is being compared against.

  // Feed the SAME-FILE edit-prediction history. recordEdit is a write-only hot path
  // (no re-render). The latest cursor line + buffer are kept in refs so an edit knows
  // where it happened without extra renders.
  const cursorLineRef = useRef(0)
  const bufferRef = useRef(buffer)
  useEffect(() => {
    bufferRef.current = buffer
  }, [buffer])
  const handleChange = useCallback(
    (value: string, changes?: readonly EditorContentChange[]) => {
      // bufferRef still holds the PRE-change content here (its effect runs post-render),
      // so it is the before→after diff baseline for the edit-history event.
      const prev = bufferRef.current
      setBuffer(value)
      // Where the edit happened comes from the change deltas the editor already carries:
      // the content event fires BEFORE the caret moves, so `cursorLineRef` still holds
      // the pre-edit line, and a multi-cursor edit reports several changes at once.
      // Programmatic callers (e.g. Convert Indentation) pass no deltas — fall back.
      if (editPath)
        recordEdit(editPath, prev, value, primaryChangeLine(changes) ?? cursorLineRef.current)
    },
    [setBuffer, editPath],
  )
  const mergeConflicts = useMergeConflicts(buffer, handleChange)
  // The extension paints the blocks; the bar resolves them. Appended rather than replacing so a
  // caller-supplied extension (the SQL active-statement highlight) still arrives.
  const editorExtensions = useMemo(
    () => [...(extensions ?? []), mergeConflictExtension],
    [extensions],
  )
  const handleCursorLine = useCallback(
    (line: number) => {
      cursorLineRef.current = line
      setCursorLine(line)
    },
    [setCursorLine],
  )

  // Language integration (SQL .sql files): layer a schema-aware completion source
  // ahead of the LSP one, injecting the live buffer so the aux source stays pure.
  const effectiveCompletionSource = useMemo<CompletionSource | undefined>(() => {
    if (!workItemVisible) return undefined
    if (!auxCompletionSource) return completionSource
    return async (pos: EditorPosition) => {
      const aux = await auxCompletionSource(bufferRef.current, pos)
      const lsp = completionSource ? await completionSource(pos).catch(() => []) : []
      return [...aux, ...lsp]
    }
  }, [workItemVisible, auxCompletionSource, completionSource])

  // Current editor run context (whole text + selection + caret) for the Run gesture.
  const getRunContext = useCallback<() => EditorRunContext>(
    () => ({
      fullText: bufferRef.current,
      selectedText: editorApiRef.current?.getSelectedText() ?? '',
      cursorOffset: editorApiRef.current?.getCursorOffset() ?? 0,
      formatDocument: () => editorApiRef.current?.formatDocument() ?? Promise.resolve(),
    }),
    [editorApiRef],
  )
  // Hand the getter to a docked panel (its Run button) once — getRunContext is stable.
  useEffect(() => {
    bindRunContext?.(getRunContext)
  }, [bindRunContext, getRunContext])
  const handleSubmit = useCallback(() => {
    onRun?.(getRunContext())
  }, [onRun, getRunContext])

  // Caret Ln/Col + selection size for the editor status bar and live composer context.
  const [cursorStatus, setCursorStatus] = useState<EditorCursorStatus | null>(null)
  const [selection, setSelection] = useState<EditorTextSelection | null>(null)

  // Markdown split view: editor | rendered preview, scroll-synced. See useSplitScrollSync.
  const { splitView, toggleSplit, editorHostEl, setEditorHostEl, setPreviewEl, onEditorScroll } =
    useSplitScrollSync()

  // The rendered preview re-parses the WHOLE document on every buffer change, so a
  // split-view keystroke used to pay a full markdown parse + React reconcile of the
  // preview subtree. Reuse the transcript's proven streaming throttle (leading +
  // trailing, with a length-based backoff for long documents): the preview lands at
  // most one interval behind, and its trailing commit guarantees the FINAL text is
  // always rendered. Off (verbatim) whenever no preview is mounted, so a plain
  // editing session schedules no timers at all.
  const previewMounted = isMarkdown(path) && (previewMarkdown || splitView)
  const previewText = useStreamingThrottle(buffer, previewMounted, STREAM_MARKDOWN_REPARSE_MS)

  // "Change Language Mode" (⌘K M): a per-tab syntax override picked from
  // the status bar, or `null` to follow the path-detected language. Reset when the
  // tab shows a different file (a new grid WorkItem remounts, but a re-target reuses it).
  const autoLanguage = languageFromPath(path)
  const [languageOverride, setLanguageOverride] = useState<string | null>(null)
  // Reset the override when the tab re-targets a different file (adjust-state-
  // during-render pattern — avoids an effect + a stale-highlight flash).
  const [langOverridePath, setLangOverridePath] = useState(path)
  if (path !== langOverridePath) {
    setLangOverridePath(path)
    setLanguageOverride(null)
  }
  const language = languageOverride ?? autoLanguage

  // Review-comment surface (highlighted ranges, add-from-selection/diagnostic, batch
  // send-to-agent / contributed comment actions). See useFileComments.
  const {
    sessionComments,
    commentRanges,
    onAddComment,
    requestFix,
    navigateToComment,
    setCommentBody,
    removeComment,
    clearComments,
    sendingComments,
    runningCommentAction,
    sendComments,
    runCommentAction,
  } = useFileComments({ sessionId, editPath, path, buffer, dirty, save, language, diagnostics })

  // A non-empty selection is the strongest live meaning of this editable tab:
  // publish exactly those bytes plus coordinates. Clearing it restores the dirty
  // buffer snapshot (when needed) or the tab's static saved-file binding.
  //
  // Beside whichever of those applies rides the editor state — the caret line and what the
  // language server reports (`editorStateContext.ts`) — so "fix this" names a line and the
  // errors on screen reach the agent without it re-deriving them. Keyed on the caret LINE:
  // column moves would republish on every arrow key for no change in meaning.
  const caretLine = cursorStatus?.line ?? null
  const editorState = useMemo(
    () =>
      editPath
        ? editorStateMessageBinding({ path: editPath, cursorLine: caretLine, diagnostics })
        : null,
    [editPath, caretLine, diagnostics],
  )
  useEffect(() => {
    if (!publishMessageContext) return
    const state = editorState ? [editorState] : []
    if (selection && editPath) {
      publishMessageContext({
        strategy: 'replace',
        bindings: [
          fileSelectionMessageBinding({
            ...selection,
            path: editPath,
            language,
          }),
          ...state,
        ],
      })
      return
    }
    if (dirty) {
      publishMessageContext({
        strategy: 'replace',
        bindings: [
          snippetMessageBindingDraft({
            label: `Unsaved buffer · ${path}`,
            content: buffer,
            language,
          }),
          ...state,
        ],
      })
      return
    }
    publishMessageContext(state.length > 0 ? { strategy: 'append', bindings: state } : null)
  }, [buffer, dirty, editPath, editorState, language, path, publishMessageContext, selection])

  // Editor go-to-definition / cross-reference navigation (distinct from comments).
  const onLocationNavigate = useCallback(
    (loc: { file: string; line: number; column?: number }) => {
      if (!sessionId) return
      openFileInGrid({
        sessionId,
        path: loc.file,
        line: loc.line + 1,
        ...(loc.column !== undefined ? { column: loc.column } : {}),
      })
    },
    [sessionId],
  )

  // Peek Definition (Alt+F12): preview the definition inline in a docked panel
  // without navigating away; "Open" then jumps there for real. This tab remounts
  // per file (keyed by path in the grid), so the peek never outlives its file.
  // The read lives here rather than in the panel: the panel unmounts when the peek
  // closes, and a problem owner that unmounts can never settle its row.
  const [peekTarget, setPeekTarget] = useState<PeekTarget | null>(null)
  const peekView = usePeekDefinition(sessionId, peekTarget)
  const onPeekDefinition = useCallback((loc: PeekTarget) => setPeekTarget(loc), [])
  const openPeekTarget = useCallback(
    (loc: PeekTarget) => {
      onLocationNavigate({ file: loc.file, line: loc.line, column: loc.character })
      setPeekTarget(null)
    },
    [onLocationNavigate],
  )

  if (state.status === 'loading') {
    return (
      <LoadingHint className="min-h-0 flex-1 text-xs">
        {state.reconnecting ? 'Reconnecting to the local service…' : `Loading ${baseName(path)}…`}
      </LoadingHint>
    )
  }
  if (state.status === 'error') {
    return (
      <StateNotice
        icon={FileX2}
        title={baseName(path)}
        body={problem && <ProblemLine {...problem} className="items-center" />}
      />
    )
  }

  // Safety net: pdf/office/spreadsheet files have dedicated read-only viewers that the
  // editor grid routes them to. If one reaches the code editor directly (a caller that
  // bypassed that routing), don't try to edit it or render its bytes as text — surface
  // a read-only notice keyed off the shared content-type routing.
  const docContentType = contentTypeForPath(path)
  if (docContentType) {
    return (
      <StateNotice
        icon={FileText}
        title={baseName(path)}
        body={
          isOpenExternallyType(docContentType)
            ? 'This document is read-only in-app — open it from the file tree to use its viewer.'
            : 'This file opens as a table, not in the code editor.'
        }
      />
    )
  }

  // Editable text opens directly in the editor (no Edit button). Markdown can flip
  // to a rendered, read-only Preview of the current buffer and back.
  if (state.editable) {
    const markdownFile = isMarkdown(path)
    const htmlFile = isHtml(path)
    // Markdown view modes: the plain rendered preview (editor hidden) vs the split
    // (editor + scroll-synced preview). Split takes precedence over the plain toggle.
    const showSplit = markdownFile && splitView
    const showPreviewOnly = markdownFile && previewMarkdown && !splitView
    const editorHidden = showPreviewOnly // the editor pane is absent only in preview-only
    return (
      <div className="relative flex min-h-0 flex-1 flex-col" onFocusCapture={onEditorFocus}>
        {problem && <ProblemLine {...problem} className="px-3 py-1.5" />}
        {conflict && (
          <WorkbenchNoticeBar
            role="alert"
            tone="warning"
            icon={<TriangleAlert className="size-3.5" />}
            title="This file changed on disk since you opened it. Reconcile your unsaved edits:"
            actionsLabel="File conflict actions"
            actions={
              <>
                <Button size="xs" variant="outline" disabled={saving} onClick={compareWithDisk}>
                  Compare
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void overwrite()}
                >
                  Overwrite disk
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void reloadFromDisk()}
                >
                  Discard &amp; reload
                </Button>
              </>
            }
          />
        )}
        <FileEditorToolbar
          dirty={dirty}
          saving={saving}
          comments={sessionComments}
          sendingComments={sendingComments}
          runningCommentAction={runningCommentAction}
          onRemoveComment={removeComment}
          onClearComments={clearComments}
          onSendComments={() => void sendComments()}
          onNavigateComment={navigateToComment}
          onCommentAction={(action) => void runCommentAction(action)}
          markdownFile={markdownFile}
          previewMarkdown={previewMarkdown}
          onTogglePreview={togglePreview}
          splitView={splitView}
          onToggleSplit={markdownFile ? toggleSplit : undefined}
          onOpenHtmlPreview={
            htmlFile && sessionId
              ? () => openPreviewFromClick(sessionId, editPath || path)
              : undefined
          }
          onSave={() => void save()}
          copyText={buffer}
        >
          <SymbolBreadcrumbBar
            fileName={baseName(editPath || path)}
            symbolPath={symbolPath}
            docSymbols={docSymbols}
            onJump={(ln) => {
              // The closing menu restores focus to its trigger. Reveal after that
              // restoration so the destination gets both editor focus and its flash.
              requestAnimationFrame(() => editorApiRef.current?.revealLine(ln))
            }}
            bordered={false}
          />
        </FileEditorToolbar>
        <div className="relative flex min-h-0 flex-1">
          {/* A file carrying conflict markers gets its resolver, whatever put them there — a
              merge, a rebase, a half-applied patch. Nothing here knows about git. */}
          {mergeConflicts.conflicts.length > 0 && (
            <MergeConflictBar
              conflict={mergeConflicts.conflicts[mergeConflicts.index]!}
              index={mergeConflicts.index}
              count={mergeConflicts.conflicts.length}
              onNavigate={(next) => {
                const line = mergeConflicts.navigate(next)
                if (line !== null) editorApiRef.current?.revealLine(line)
              }}
              onResolve={mergeConflicts.resolve}
            />
          )}
          {showPreviewOnly ? (
            <div className="h-full flex-1 overflow-auto px-4 py-4 text-sm text-foreground scrollbar-thin">
              <MarkdownRenderer>{previewText}</MarkdownRenderer>
            </div>
          ) : (
            <div ref={setEditorHostEl} className="relative h-full min-w-0 flex-1">
              {/* Diff chip — one affordance for the next-edit diff. The mini-diffs show
                WHAT changes; the chip says WHERE + HOW MANY. Tab acts on the first. */}
              {nextEdits && nextEdits.length > 0 && editPath && (
                <div
                  className={`pointer-events-none absolute bottom-3 right-3 z-(--z-controls) flex items-center gap-1.5 px-2 py-1 text-xs text-text-soft ${FLOATING_SURFACE}`}
                >
                  <WandSparkles className="size-3.5 shrink-0 text-accent-foreground" aria-hidden />
                  <span>
                    {nextEdits.length === 1 ? 'Next edit' : `${nextEdits.length} edits`} in{' '}
                    <span className="font-medium text-foreground">{baseName(editPath)}</span>
                  </span>
                  <Kbd className="ml-1 text-2xs text-text-soft">Tab</Kbd>
                </div>
              )}
              <CodeEditor
                scrollSyncHost={showSplit ? editorHostEl : null}
                onScroll={showSplit ? onEditorScroll : undefined}
                value={buffer}
                language={language}
                extensions={editorExtensions}
                viewState={viewStateBridge}
                diagnostics={diagnostics}
                dirtyDiff={enhancement.dirtyDiff?.feed}
                externalChanges={externalChanges}
                hoverSource={hoverSource}
                completionSource={effectiveCompletionSource}
                signatureHelpSource={signatureHelpSource}
                nextEditSource={nextEditSource}
                nextEdit={nextEdits}
                onNextEdit={setNextEdits}
                onSubmit={onRun ? handleSubmit : undefined}
                submitActionLabel="Run Selection or Statement"
                onCursorLineChange={handleCursorLine}
                onCursorPositionChange={setCursorStatus}
                onSelectionChange={setSelection}
                onEditorReady={(api) => {
                  editorApiRef.current = api
                }}
                stickySymbols={docSymbols}
                onFixRequest={requestFix}
                onAddComment={onAddComment}
                commentRanges={commentRanges}
                filePath={editPath}
                definitionSource={definitionSource}
                definitionTargetSource={definitionTargetSource}
                implementationSource={implementationSource}
                typeDefinitionSource={typeDefinitionSource}
                referencesSource={referencesSource}
                documentHighlightSource={documentHighlightSource}
                inlayHintSource={inlayHintSource}
                blameSource={lineAuthorshipEnabled ? enhancement.blameSource : undefined}
                scrollbarMarkersEnabled={scrollbarMarkersEnabled}
                bracketColorizationEnabled={bracketColorizationEnabled}
                documentColorSource={documentColorSource}
                prepareRenameSource={prepareRenameSource}
                renameSource={renameSource}
                onRenameApplied={lspEditSettled('Renamed')}
                formatSource={formatSource}
                formatText={formatText}
                codeActionSource={codeActionSource}
                applyCodeActionSource={applyCodeActionSource}
                onCodeActionApplied={lspEditSettled('Applied fix')}
                hunkSource={enhancement.dirtyDiff?.hunkSource}
                revertHunkSource={enhancement.dirtyDiff?.revertHunk}
                onHunkReverted={enhancement.dirtyDiff?.onHunkReverted}
                onLocationNavigate={onLocationNavigate}
                onPeekDefinition={onPeekDefinition}
                onEditComment={setCommentBody}
                initialLine={line}
                initialColumn={column}
                initialEndLine={endLine}
                initialEndColumn={endColumn}
                revealKey={revealAt}
                onChange={handleChange}
                onSave={() => void save()}
                ariaLabel={`Editing ${baseName(path)}`}
              />
            </div>
          )}
          {showSplit && (
            // Scroll-synced rendered preview (right half). Observes its own sync
            // attribute + publishes to the editor host (see the effect above).
            <div
              ref={setPreviewEl}
              className="h-full flex-1 overflow-auto border-l border-border-soft px-4 py-4 text-sm text-foreground scrollbar-thin"
            >
              <MarkdownRenderer>{previewText}</MarkdownRenderer>
            </div>
          )}
        </div>
        {bottomPanel && !editorHidden && (
          <div className="flex min-h-0 basis-2/5 flex-col">{bottomPanel}</div>
        )}
        {peekTarget && !editorHidden && sessionId && (
          <PeekDefinitionPanel
            target={peekTarget}
            view={peekView}
            onOpen={openPeekTarget}
            onClose={() => setPeekTarget(null)}
          />
        )}
        {!editorHidden && (
          // Contributed INTO the app's single status bar rather than docked under
          // the editor — the two stacked bars read as a misaligned step next to
          // the chat column, which has none. The items (and their two menus) are
          // unchanged; only where they render moved.
          <WorkbenchStatusContribution active={workItemFocused}>
            <EditorStatusBar
              cursor={cursorStatus}
              text={buffer}
              language={language}
              autoLanguage={autoLanguage}
              onLanguageChange={setLanguageOverride}
              onConvertIndentation={handleChange}
            />
          </WorkbenchStatusContribution>
        )}
      </div>
    )
  }

  if (state.mimeType?.startsWith('image/')) {
    return (
      <FileImageView
        path={path}
        content={state.content}
        mimeType={state.mimeType}
        encoding={state.encoding}
        truncated={state.truncated}
      />
    )
  }

  // Non-image binary (read back as mojibake) — don't render garbage as code.
  if (!isMarkdown(path) && looksBinary(state.content)) {
    return (
      <StateNotice
        icon={FileX2}
        title={baseName(path)}
        body="Binary file — preview not supported."
      />
    )
  }

  // An empty file would render as a blank panel — say so explicitly.
  if (state.content === '') {
    return <StateNotice title={baseName(path)} body="Empty file" />
  }

  return (
    <FileReadonlyView path={path} content={state.content} truncated={state.truncated} line={line} />
  )
}
