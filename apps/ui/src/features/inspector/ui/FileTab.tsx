import { useMemo, useRef, useState } from 'react'
import { FileX2, TriangleAlert } from 'lucide-react'
import { FileEditorEnhancements } from '@/shared/contrib/FileEditorEnhancements'
import type { EditorCursorStatus, EditorTextSelection } from '@/shared/ui/code-editor/CodeEditor'
import { openPreviewFromClick } from '../model/openPreview'
import { STREAM_MARKDOWN_REPARSE_MS, useStreamingThrottle } from '@/shared/ui/useStreamingThrottle'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { ProblemLine } from '@/shared/ui/problem-report'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { useActiveEditorSave } from '@/shared/lib/activeEditorBus'
import { isHtml, isMarkdown } from './fileTabHelpers'
import {
  useEditorMessageContext,
  useFileDiagnostics,
  useFormatOnSaveRunner,
  useTabDirtyMark,
} from './fileTabEffects'
import { contentTypeForPath } from '@/shared/lib/contentTypeRouting'
import { useFileLsp } from './useFileLsp'
import { useSplitScrollSync } from './useSplitScrollSync'
import { useFileComments } from './useFileComments'
import { useFileEditor, type FormatOnSaveRunner } from './useFileEditor'
import { useSymbolBreadcrumb } from './useSymbolBreadcrumb'
import { SymbolBreadcrumbBar } from './SymbolBreadcrumbBar'
import { FileEditorToolbar } from './FileEditorToolbar'
import { EditorStatusBar } from './EditorStatusBar'
import { PeekDefinitionPanel } from './PeekDefinitionPanel'
import { mergeConflictExtension } from './mergeConflictExtension'
import { useMergeConflicts } from '../model/useMergeConflicts'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { useWorkItemFocused } from '@localixai/kit/work-item-focus'
import { WorkbenchStatusContribution } from '@localixai/kit/workbench-statusbar'
import { FileCodeEditor } from './FileCodeEditor'
import { FileEditorBody } from './FileEditorBody'
import { FileDocumentNotice, FileStaticView } from './FileStaticView'
import { useEditorViewStateBridge } from './useEditorViewStateBridge'
import type { FileTabProps, SessionFileTabProps } from './fileTabProps'
import { useFileTabEditing } from './useFileTabEditing'
import { useFileTabNavigation } from './useFileTabNavigation'
import { useLanguageOverride } from './useLanguageOverride'

export type { EditorRunContext, FileTabProps } from './fileTabProps'

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
  // Caret + scroll persistence across a tab reopen / reload.
  const viewStateBridge = useEditorViewStateBridge(sessionId, path, line)

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

  useTabDirtyMark(itemId, dirty)

  const onEditorFocus = useActiveEditorSave(() => void save())

  const diagnostics = useFileDiagnostics(sessionId, editPath)

  // Language-feature providers (hover/completion/signature/definition/references)
  // wired to the backend LSP over the realtime socket, keyed by the resolved path.
  const lsp = useFileLsp(sessionId, editPath, nextEditContextSource, flushLspSync)

  useFormatOnSaveRunner(formatOnSaveRef, lsp.formatOnSaveEnabled, lsp.formatSource)

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

  const { handleChange, handleCursorLine, effectiveCompletionSource, handleSubmit } =
    useFileTabEditing({
      buffer,
      setBuffer,
      editPath,
      setCursorLine,
      editorApiRef,
      workItemVisible,
      completionSource: lsp.completionSource,
      auxCompletionSource,
      bindRunContext,
      onRun,
    })
  const mergeConflicts = useMergeConflicts(buffer, handleChange)
  // The extension paints the blocks; the bar resolves them. Appended rather than replacing so a
  // caller-supplied extension (the SQL active-statement highlight) still arrives.
  const editorExtensions = useMemo(
    () => [...(extensions ?? []), mergeConflictExtension],
    [extensions],
  )

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

  const { autoLanguage, language, setLanguageOverride } = useLanguageOverride(path)

  // Review-comment surface (highlighted ranges, add-from-selection/diagnostic, batch
  // send-to-agent / contributed comment actions). See useFileComments.
  const comments = useFileComments({
    sessionId,
    editPath,
    path,
    buffer,
    dirty,
    save,
    language,
    diagnostics,
  })

  useEditorMessageContext({
    publishMessageContext,
    editPath,
    path,
    buffer,
    dirty,
    language,
    caretLine: cursorStatus?.line ?? null,
    diagnostics,
    selection,
  })

  const { onLocationNavigate, peekTarget, peekView, onPeekDefinition, openPeekTarget, closePeek } =
    useFileTabNavigation(sessionId)

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

  // A pdf/office/spreadsheet that bypassed the grid's viewer routing — see FileDocumentNotice.
  const docContentType = contentTypeForPath(path)
  if (docContentType) return <FileDocumentNotice path={path} contentType={docContentType} />

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
                <Button size="xs" variant="ghost" disabled={saving} onClick={compareWithDisk}>
                  Compare
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => void overwrite()}
                >
                  Overwrite disk
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
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
          comments={comments.sessionComments}
          sendingComments={comments.sendingComments}
          runningCommentAction={comments.runningCommentAction}
          onRemoveComment={comments.removeComment}
          onClearComments={comments.clearComments}
          onSendComments={() => void comments.sendComments()}
          onNavigateComment={comments.navigateToComment}
          onCommentAction={(action) => void comments.runCommentAction(action)}
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
        <FileEditorBody
          mergeConflicts={mergeConflicts}
          editorApiRef={editorApiRef}
          showPreviewOnly={showPreviewOnly}
          showSplit={showSplit}
          previewText={previewText}
          setEditorHostEl={setEditorHostEl}
          setPreviewEl={setPreviewEl}
        >
          <FileCodeEditor
            path={path}
            editPath={editPath}
            lsp={lsp}
            enhancement={enhancement}
            editorApiRef={editorApiRef}
            scrollSyncHost={showSplit ? editorHostEl : null}
            onScroll={showSplit ? onEditorScroll : undefined}
            value={buffer}
            language={language}
            extensions={editorExtensions}
            viewState={viewStateBridge}
            diagnostics={diagnostics}
            externalChanges={externalChanges}
            completionSource={effectiveCompletionSource}
            onSubmit={onRun ? handleSubmit : undefined}
            onCursorLineChange={handleCursorLine}
            onCursorPositionChange={setCursorStatus}
            onSelectionChange={setSelection}
            stickySymbols={docSymbols}
            onFixRequest={comments.requestFix}
            onAddComment={comments.onAddComment}
            commentRanges={comments.commentRanges}
            formatText={formatText}
            onLocationNavigate={onLocationNavigate}
            onPeekDefinition={onPeekDefinition}
            onEditComment={comments.setCommentBody}
            initialLine={line}
            initialColumn={column}
            initialEndLine={endLine}
            initialEndColumn={endColumn}
            revealKey={revealAt}
            onChange={handleChange}
            onSave={() => void save()}
          />
        </FileEditorBody>
        {bottomPanel && !editorHidden && (
          <div className="flex min-h-0 basis-2/5 flex-col">{bottomPanel}</div>
        )}
        {peekTarget && !editorHidden && sessionId && (
          <PeekDefinitionPanel
            target={peekTarget}
            view={peekView}
            onOpen={openPeekTarget}
            onClose={closePeek}
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

  return <FileStaticView path={path} state={state} line={line} />
}
