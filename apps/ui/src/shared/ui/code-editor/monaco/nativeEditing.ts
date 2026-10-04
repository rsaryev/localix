import type * as Monaco from 'monaco-editor'
import { registerNativeEditTarget } from '@/shared/lib/nativeEditing'

/** Native edit commands must follow text focus, including split editors and nested find inputs. */
export function registerMonacoNativeEditing(
  editor: Monaco.editor.IStandaloneCodeEditor,
  isReadOnly: () => boolean,
): Monaco.IDisposable {
  const dispose = registerNativeEditTarget((command) => {
    if (!editor.hasTextFocus()) return false
    if (command !== 'select_all' && isReadOnly()) return true
    editor.trigger(
      'native-menu',
      command === 'select_all' ? 'editor.action.selectAll' : command,
      null,
    )
    return true
  })
  return { dispose }
}
