import type * as Monaco from 'monaco-editor'
import type {
  CommentedRange,
  EditorPosition,
  EditorReference,
  EditorSelectionRange,
  HunkSource,
  RevertHunkSource,
} from '../types'
import type { createEditorWidgets } from './editorWidgets'
import type { MonacoApi } from './runtime'

/** Props consumed by Monaco commands and their context-menu visibility guards. */
export interface CodeEditorActionProps {
  onSave?: () => void
  onSubmit?: () => void
  submitActionLabel?: string
  onAddComment?: (selection: EditorSelectionRange, body: string) => void
  commentRanges?: CommentedRange[]
  onEditComment?: (id: string, body: string) => void
  filePath?: string
  implementationSource?: (position: EditorPosition) => Promise<EditorReference[]>
  typeDefinitionSource?: (position: EditorPosition) => Promise<EditorReference[]>
  referencesSource?: (position: EditorPosition) => Promise<EditorReference[]>
  hunkSource?: HunkSource
  revertHunkSource?: RevertHunkSource
  onHunkReverted?: () => void
  onLocationNavigate?: (location: { file: string; line: number; column?: number }) => void
}

interface EditorActionRuntime {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  widgets: ReturnType<typeof createEditorWidgets>
  syncActionContexts?: () => void
}

function editorPosition(position: Monaco.Position): EditorPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

/**
 * Register the editor's user commands in one imperative adapter.
 *
 * Callbacks stay lazy through getProps so registrations survive React prop changes without
 * re-registering Monaco actions or closing an open command widget.
 *
 * No `contextMenuGroupId` on any of them: Monaco's own menu is off, and the editor's right-click
 * list is described — order, grouping, shortcut hints and all — in `../editorContextMenu.ts`, which
 * reaches these by id. A group id here would place a row in a menu nothing draws.
 */
export function addEditorActions(
  runtime: EditorActionRuntime,
  getProps: () => CodeEditorActionProps,
): Monaco.IDisposable[] {
  const { monaco, editor, model, widgets } = runtime
  const actions: Monaco.IDisposable[] = []
  const hasSave = editor.createContextKey<boolean>('localixHasSave', false)
  const hasSubmit = editor.createContextKey<boolean>('localixHasSubmit', false)
  const hasImplementation = editor.createContextKey<boolean>('localixHasImplementation', false)
  const hasTypeDefinition = editor.createContextKey<boolean>('localixHasTypeDefinition', false)
  const hasReferences = editor.createContextKey<boolean>('localixHasReferences', false)
  const hasComments = editor.createContextKey<boolean>('localixHasComments', false)
  const hasRevert = editor.createContextKey<boolean>('localixHasRevert', false)
  runtime.syncActionContexts = () => {
    const current = getProps()
    hasSave.set(Boolean(current.onSave))
    hasSubmit.set(Boolean(current.onSubmit))
    hasImplementation.set(Boolean(current.implementationSource))
    hasTypeDefinition.set(Boolean(current.typeDefinitionSource))
    hasReferences.set(Boolean(current.referencesSource))
    hasComments.set(Boolean(current.onAddComment))
    hasRevert.set(Boolean(current.hunkSource && current.revertHunkSource))
  }
  runtime.syncActionContexts()
  const currentPosition = () => editorPosition(editor.getPosition() ?? new monaco.Position(1, 1))
  const navigate = (location: { file: string; line: number; character?: number } | null) => {
    if (!location) return
    const props = getProps()
    if (location.file === props.filePath) {
      const lineNumber = Math.min(Math.max(location.line + 1, 1), model.getLineCount())
      const column = Math.min(
        Math.max((location.character ?? 0) + 1, 1),
        model.getLineMaxColumn(lineNumber),
      )
      editor.setPosition({ lineNumber, column })
      editor.revealPositionInCenter({ lineNumber, column }, monaco.editor.ScrollType.Smooth)
      editor.focus()
    } else {
      props.onLocationNavigate?.({
        file: location.file,
        line: location.line,
        column: location.character,
      })
    }
  }

  // One target is jumped to directly; several open the references list under `title`.
  const goToTargets = async (
    source: 'implementationSource' | 'typeDefinitionSource',
    title: string,
  ) => {
    const references = await getProps()[source]?.(currentPosition())
    if (!references?.length) return
    if (references.length === 1) navigate(references[0]!)
    else widgets.openReferences(title, references, navigate)
  }

  actions.push(
    editor.addAction({
      id: `localix.save.${editor.getId()}`,
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      precondition: 'localixHasSave',
      run: () => getProps().onSave?.(),
    }),
    editor.addAction({
      id: `localix.submit.${editor.getId()}`,
      label: getProps().submitActionLabel ?? 'Submit',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      precondition: 'editorTextFocus && localixHasSubmit',
      run: () => getProps().onSubmit?.(),
    }),
    editor.addAction({
      id: `localix.implementation.${editor.getId()}`,
      label: 'Go to Implementation',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12],
      precondition: 'localixHasImplementation',
      run: () => goToTargets('implementationSource', 'Implementations'),
    }),
    editor.addAction({
      id: `localix.typeDefinition.${editor.getId()}`,
      label: 'Go to Type Definition',
      precondition: 'localixHasTypeDefinition',
      run: () => goToTargets('typeDefinitionSource', 'Type Definitions'),
    }),
    editor.addAction({
      id: `localix.references.${editor.getId()}`,
      label: 'Find All References',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
      precondition: 'localixHasReferences',
      run: async () => {
        const references = await getProps().referencesSource?.(currentPosition())
        if (!references?.length) return
        widgets.openReferences('References', references, navigate)
      },
    }),
    editor.addAction({
      id: `localix.leaveComment.${editor.getId()}`,
      label: 'Leave Comment',
      precondition: 'localixHasComments',
      run: () => {
        const selection = editor.getSelection()
        if (!selection || !getProps().onAddComment) return
        const selected = selection.isEmpty()
          ? {
              line: selection.startLineNumber - 1,
              endLine: selection.startLineNumber - 1,
              text: model.getLineContent(selection.startLineNumber),
            }
          : {
              line: selection.startLineNumber - 1,
              endLine: selection.endLineNumber - 1,
              text: model.getValueInRange(selection),
            }
        widgets.openComment({
          selection: selected,
          label: 'Leave comment',
          submitLabel: 'Comment',
          onSubmit: (body) => getProps().onAddComment?.(selected, body),
        })
      },
    }),
    editor.addAction({
      id: `localix.revertHunk.${editor.getId()}`,
      label: 'Revert Change',
      precondition: 'localixHasRevert',
      run: async () => {
        const props = getProps()
        const line = editor.getPosition()?.lineNumber
        if (!line || !props.hunkSource || !props.revertHunkSource) return
        const hunk = await props.hunkSource(line)
        if (!hunk) return
        widgets.openRevert(hunk, () => props.revertHunkSource!(hunk), props.onHunkReverted)
      },
    }),
    editor.onMouseDown((event) => {
      if (
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        !event.target.position
      )
        return
      const props = getProps()
      const line = event.target.position.lineNumber - 1
      const comment = props.commentRanges?.find(
        (candidate) => line >= candidate.line && line <= candidate.endLine && candidate.id,
      )
      if (!comment?.id || !props.onEditComment) return
      event.event.preventDefault()
      const selection = {
        line: comment.line,
        endLine: comment.endLine,
        text: model.getValueInRange(
          new monaco.Range(
            comment.line + 1,
            1,
            comment.endLine + 1,
            model.getLineMaxColumn(comment.endLine + 1),
          ),
        ),
      }
      widgets.openComment({
        selection,
        initialBody: comment.body,
        label: 'Edit comment',
        submitLabel: 'Save',
        onSubmit: (body) => getProps().onEditComment?.(comment.id!, body),
      })
    }),
  )
  return actions
}
