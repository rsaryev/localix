import { useState, type MutableRefObject } from 'react'
import { Kbd } from '@localixai/kit/kbd'
import { WandSparkles } from 'lucide-react'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import type { FileHistoryEnhancement } from '@/shared/ui/code-editor/fileEnhancement'
import {
  CodeEditor,
  type CodeEditorProps,
  type EditorHandle,
  type EditorRenameResult,
  type EditorSuggestion,
} from '@/shared/ui/code-editor/CodeEditor'
import { settleLspEdit, type LspEditVerb } from '../model/lspEditResult'
import type { useFileLsp } from './useFileLsp'

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

type ManagedProps =
  | 'hoverSource'
  | 'signatureHelpSource'
  | 'nextEditSource'
  | 'nextEdit'
  | 'onNextEdit'
  | 'submitActionLabel'
  | 'onEditorReady'
  | 'filePath'
  | 'definitionSource'
  | 'definitionTargetSource'
  | 'implementationSource'
  | 'typeDefinitionSource'
  | 'referencesSource'
  | 'documentHighlightSource'
  | 'inlayHintSource'
  | 'blameSource'
  | 'scrollbarMarkersEnabled'
  | 'bracketColorizationEnabled'
  | 'documentColorSource'
  | 'prepareRenameSource'
  | 'renameSource'
  | 'onRenameApplied'
  | 'formatSource'
  | 'codeActionSource'
  | 'applyCodeActionSource'
  | 'onCodeActionApplied'
  | 'dirtyDiff'
  | 'hunkSource'
  | 'revertHunkSource'
  | 'onHunkReverted'
  | 'ariaLabel'

type FileCodeEditorProps = Omit<CodeEditorProps, ManagedProps> & {
  path: string
  editPath: string
  lsp: ReturnType<typeof useFileLsp>
  enhancement: FileHistoryEnhancement
  editorApiRef: MutableRefObject<EditorHandle | null>
}

/**
 * The file tab's Monaco editor: LSP providers, contributed history adornments and the
 * next-edit chip wired around one CodeEditor.
 */
export function FileCodeEditor({
  path,
  editPath,
  lsp,
  enhancement,
  editorApiRef,
  ...editor
}: FileCodeEditorProps) {
  const [nextEdits, setNextEdits] = useState<EditorSuggestion[] | null>(null)
  return (
    <>
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
        {...editor}
        dirtyDiff={enhancement.dirtyDiff?.feed}
        hoverSource={lsp.hoverSource}
        signatureHelpSource={lsp.signatureHelpSource}
        nextEditSource={lsp.nextEditSource}
        nextEdit={nextEdits}
        onNextEdit={setNextEdits}
        submitActionLabel="Run Selection or Statement"
        onEditorReady={(api) => {
          editorApiRef.current = api
        }}
        filePath={editPath}
        definitionSource={lsp.definitionSource}
        definitionTargetSource={lsp.definitionTargetSource}
        implementationSource={lsp.implementationSource}
        typeDefinitionSource={lsp.typeDefinitionSource}
        referencesSource={lsp.referencesSource}
        documentHighlightSource={lsp.documentHighlightSource}
        inlayHintSource={lsp.inlayHintSource}
        blameSource={lsp.lineAuthorshipEnabled ? enhancement.blameSource : undefined}
        scrollbarMarkersEnabled={lsp.scrollbarMarkersEnabled}
        bracketColorizationEnabled={lsp.bracketColorizationEnabled}
        documentColorSource={lsp.documentColorSource}
        prepareRenameSource={lsp.prepareRenameSource}
        renameSource={lsp.renameSource}
        onRenameApplied={lspEditSettled('Renamed')}
        formatSource={lsp.formatSource}
        codeActionSource={lsp.codeActionSource}
        applyCodeActionSource={lsp.applyCodeActionSource}
        onCodeActionApplied={lspEditSettled('Applied fix')}
        hunkSource={enhancement.dirtyDiff?.hunkSource}
        revertHunkSource={enhancement.dirtyDiff?.revertHunk}
        onHunkReverted={enhancement.dirtyDiff?.onHunkReverted}
        ariaLabel={`Editing ${baseName(path)}`}
      />
    </>
  )
}
