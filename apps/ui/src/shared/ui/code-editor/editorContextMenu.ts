import type * as Monaco from 'monaco-editor'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { toast } from '@/shared/lib/notify'
import { formatChordText } from '@/shared/lib/keybindings'
import { OS_FAMILY } from '@localixai/kit/environment'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'

/**
 * The editor's right-click menu, described as `MenuEntry[]` like every other menu in the app.
 *
 * Monaco ships its own, and the app used to let it draw: a menu built from `MenuId.EditorContext`,
 * themed through `menu.background`, painted by `vs/base/browser/ui/menu`. It was never the app's
 * menu and could not be made into one — `monacoEditor.css` carried ~60 lines of `!important`
 * chasing Monaco's inline styles, and the right-click menu STILL showed the code straight through
 * it, because Monaco resolves `--popover` through a canvas that keeps its alpha and then paints
 * that translucent fill with no blur behind it. A material is a fill AND its backdrop; half of one
 * is a hole. The same argument the terminal already settled with `terminalContextMenu` (xterm has
 * no menu of its own, so there was nothing to fight) applies here with the fight included.
 *
 * So Monaco's menu is off (`contextmenu: false`, which also keeps its useful half: the editor still
 * focuses and moves the caret on right-click, it just does not draw or swallow the event) and this
 * describes the same list for `MenuEntries`. One surface, one item recipe, one danger treatment.
 *
 * Built FRESH on each open — like the terminal's, and for the same reason: nearly every row's
 * availability is state Monaco owns and React never sees. `isSupported()` reads the live
 * precondition, so a file with no rename provider simply has no Rename row rather than a dead one.
 */

/** Monaco commands this menu reaches for, in the order the menu lists them. */
const REVEAL_DEFINITION = 'editor.action.revealDefinition'
const PEEK_DEFINITION = 'editor.action.peekDefinition'
const PEEK_TYPE_DEFINITION = 'editor.action.peekTypeDefinition'
const PEEK_IMPLEMENTATION = 'editor.action.peekImplementation'
const PEEK_REFERENCES = 'editor.action.referenceSearch.trigger'
const QUICK_OUTLINE = 'editor.action.quickOutline'
const RENAME = 'editor.action.rename'
const CHANGE_ALL = 'editor.action.changeAll'
const FORMAT_DOCUMENT = 'editor.action.formatDocument'
const REFACTOR = 'editor.action.refactor'
const SOURCE_ACTION = 'editor.action.sourceAction'
const QUICK_COMMAND = 'editor.action.quickCommand'

/**
 * Chords Monaco registers for the rows above, in the app's OS-neutral grammar.
 *
 * They are transcribed rather than looked up because Monaco's keybinding SERVICE is not on the
 * public API object — reaching it means a deep import of `standaloneServices`, which would pull the
 * whole editor into the main chunk and undo the lazy `loadMonaco` split. The runtime is vendored
 * and pinned (`vendor/monaco-editor-runtime`), so these are as static as the labels beside them.
 */
const MAC = OS_FAMILY === 'mac'
const CHORD = {
  definition: 'f12',
  peekDefinition: OS_FAMILY === 'linux' ? 'mod+shift+f10' : 'alt+f12',
  peekImplementation: 'mod+shift+f12',
  quickOutline: 'mod+shift+o',
  rename: 'f2',
  changeAll: 'mod+f2',
  // Linux moves Format Document out of ⇧⌥F, which is a window-manager shortcut there.
  format: OS_FAMILY === 'linux' ? 'mod+shift+i' : 'alt+shift+f',
  // ⌃⇧R on macOS — `secondary`, not `mod`: this one is Control on every platform.
  refactor: MAC ? 'secondary+shift+r' : 'mod+shift+r',
  quickCommand: 'f1',
  cut: 'mod+x',
  copy: 'mod+c',
  paste: 'mod+v',
} as const

export interface EditorMenuOps {
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  /** Ids of the actions `addEditorActions` registered, which carry the editor's own suffix. */
  actionIds: {
    implementation: string
    typeDefinition: string
    references: string
    leaveComment: string
    revertHunk: string
  }
  readOnly: boolean
}

/** The action ids `addEditorActions` registers for `editor`, all suffixed with its instance id. */
export function localixActionIds(editorId: string): EditorMenuOps['actionIds'] {
  return {
    implementation: `localix.implementation.${editorId}`,
    typeDefinition: `localix.typeDefinition.${editorId}`,
    references: `localix.references.${editorId}`,
    leaveComment: `localix.leaveComment.${editorId}`,
    revertHunk: `localix.revertHunk.${editorId}`,
  }
}

export function editorContextMenuEntries(ops: EditorMenuOps): MenuEntry[] {
  const { editor, actionIds, readOnly } = ops
  const command = (id: string, label: string, chord?: string) =>
    commandEntry(editor, id, label, chord)
  const peek = [
    command(PEEK_DEFINITION, 'Peek Definition', CHORD.peekDefinition),
    command(PEEK_TYPE_DEFINITION, 'Peek Type Definition'),
    command(PEEK_IMPLEMENTATION, 'Peek Implementation', CHORD.peekImplementation),
    command(PEEK_REFERENCES, 'Peek References'),
  ].filter(isEntry)

  const entries: (MenuEntry | null)[] = [
    command(REVEAL_DEFINITION, 'Go to Definition', CHORD.definition),
    command(actionIds.implementation, 'Go to Implementation'),
    command(actionIds.typeDefinition, 'Go to Type Definition'),
    command(actionIds.references, 'Find All References'),
    command(QUICK_OUTLINE, 'Go to Symbol…', CHORD.quickOutline),
    peek.length > 0 ? { id: 'peek', label: 'Peek', items: peek } : null,
    { separator: true },
    command(RENAME, 'Rename Symbol', CHORD.rename),
    command(CHANGE_ALL, 'Change All Occurrences', CHORD.changeAll),
    command(FORMAT_DOCUMENT, 'Format Document', CHORD.format),
    command(actionIds.leaveComment, 'Leave Comment'),
    command(REFACTOR, 'Refactor…', CHORD.refactor),
    command(actionIds.revertHunk, 'Revert Change'),
    command(SOURCE_ACTION, 'Source Action…'),
    { separator: true },
    ...clipboardEntries(ops, readOnly),
    { separator: true },
    command(QUICK_COMMAND, 'Command Palette', CHORD.quickCommand),
  ]
  // `normalizeMenuEntries` in the walker drops the leading/doubled/trailing rules a filtered-out
  // group leaves behind, so a file with no symbol providers still opens on a clean list.
  return entries.filter(isEntry)
}

/**
 * One row backed by a Monaco command, or `null` when the editor does not offer it right now —
 * no definition provider for this language, nothing to revert on this line, a read-only model.
 */
function commandEntry(
  editor: Monaco.editor.IStandaloneCodeEditor,
  id: string,
  label: string,
  chord?: string,
): MenuEntry | null {
  const action = editor.getAction(id)
  if (!action || !action.isSupported()) return null
  return {
    id,
    label,
    hint: chord ? formatChordText(chord) : undefined,
    onSelect: () => runInEditor(editor, () => void action.run()),
  }
}

/**
 * Clipboard rows the app implements itself rather than delegating to Monaco's.
 *
 * Monaco's `clipboardPasteAction` is `document.execCommand('paste')`, which no browser has honored
 * for years — its menu offered a Paste that silently did nothing. Reading through the app's
 * clipboard port makes the row real, and routes cut/copy through the same port the terminal menu
 * uses, so one denied-clipboard answer is phrased once.
 *
 * With an empty selection the target is the whole line, including its break, which is
 * why ⌘X on a caret is a line-delete.
 */
function clipboardEntries(ops: EditorMenuOps, readOnly: boolean): MenuEntry[] {
  const { editor } = ops
  return [
    {
      id: 'cut',
      label: 'Cut',
      hint: formatChordText(CHORD.cut),
      disabled: readOnly,
      onSelect: () => runInEditor(editor, () => void cutOrCopy(ops, 'cut')),
    },
    {
      id: 'copy',
      label: 'Copy',
      hint: formatChordText(CHORD.copy),
      onSelect: () => runInEditor(editor, () => void cutOrCopy(ops, 'copy')),
    },
    {
      id: 'paste',
      label: 'Paste',
      hint: formatChordText(CHORD.paste),
      disabled: readOnly,
      onSelect: () => runInEditor(editor, () => void paste(ops)),
    },
  ]
}

/** The range the clipboard rows act on: the selection, or the caret's whole line. */
function clipboardRange(ops: EditorMenuOps): Monaco.IRange {
  const { editor, model } = ops
  const selection = editor.getSelection()
  if (selection && !selection.isEmpty()) return selection
  const line = selection?.startLineNumber ?? editor.getPosition()?.lineNumber ?? 1
  const last = line >= model.getLineCount()
  return {
    startLineNumber: line,
    startColumn: 1,
    // The line break belongs to the line being cut — except on the last one, which has none.
    endLineNumber: last ? line : line + 1,
    endColumn: last ? model.getLineMaxColumn(line) : 1,
  }
}

async function cutOrCopy(ops: EditorMenuOps, mode: 'cut' | 'copy'): Promise<void> {
  const { editor, model } = ops
  const range = clipboardRange(ops)
  const text = model.getValueInRange(range)
  if (!text) return
  if (!(await platformCapabilities().clipboard.writeText(text))) {
    toast.error('Could not write to the clipboard', {
      description: `Use ${formatChordText(mode === 'cut' ? CHORD.cut : CHORD.copy)} instead.`,
    })
    return
  }
  if (mode !== 'cut') return
  editor.pushUndoStop()
  editor.executeEdits('localix.menu.cut', [{ range, text: '', forceMoveMarkers: true }])
  editor.pushUndoStop()
}

async function paste(ops: EditorMenuOps): Promise<void> {
  const { editor } = ops
  let text: string | null
  try {
    text = await platformCapabilities().clipboard.readText()
  } catch {
    text = null
  }
  if (text == null) {
    // A denied clipboard READ is the browser's answer, not an editor failure — the keyboard path
    // still works, because a paste EVENT carries its own data and needs no permission.
    toast.error('Could not read the clipboard', {
      description: `Use ${formatChordText(CHORD.paste)} instead.`,
    })
    return
  }
  if (!text) return
  const selection = editor.getSelection()
  if (!selection) return
  editor.pushUndoStop()
  editor.executeEdits('localix.menu.paste', [{ range: selection, text, forceMoveMarkers: true }])
  editor.pushUndoStop()
}

/**
 * Run after the menu has finished closing, with the editor focused.
 *
 * Radix moves focus into the menu while it is open and restores it on close; an action run in the
 * middle of that either loses the focus it just took (Rename's input, the command palette) or runs
 * against an editor that is not focused (every cursor-relative command). A frame is the cheapest
 * point that is after Radix's focus effects and before anything the user could do next.
 */
function runInEditor(editor: Monaco.editor.IStandaloneCodeEditor, run: () => void): void {
  requestAnimationFrame(() => {
    editor.focus()
    run()
  })
}

function isEntry(entry: MenuEntry | null): entry is MenuEntry {
  return entry != null
}
