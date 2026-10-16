import type * as Monaco from 'monaco-editor'

const FIND_CLOSE_BUTTON = '.find-widget > .button.codicon-widget-close'

/**
 * Monaco 0.55's delayed pointer hover can be positioned over the find widget's
 * close button when the editor has UI above it. The hover then repeatedly steals
 * the pointer from the button, making its click unreliable. Suppress only that
 * mouseover before it reaches Monaco's delayed-hover listener; the button's click,
 * keyboard activation, aria-label, and Escape command remain native Monaco.
 */
export function stabilizeFindWidgetCloseButton(editor: Monaco.editor.IStandaloneCodeEditor) {
  const root = editor.getDomNode()
  if (!root) return { dispose() {} }

  const onMouseOver = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest(FIND_CLOSE_BUTTON)) return
    event.stopPropagation()
  }

  root.addEventListener('mouseover', onMouseOver, true)
  return {
    dispose() {
      root.removeEventListener('mouseover', onMouseOver, true)
    },
  }
}
