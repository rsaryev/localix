import type * as Monaco from 'monaco-editor'
import type { MonacoApi } from './runtime'

/** Author metadata is an overlay, never injected text that participates in caret layout. */
export function createInlineBlameWidget(
  monaco: MonacoApi,
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel,
) {
  const node = document.createElement('span')
  node.className = 'localix-monaco-inline-blame'
  let onSelect: (() => void) | undefined
  const click = () => onSelect?.()
  const keydown = (event: KeyboardEvent) => {
    if (onSelect && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      event.stopPropagation()
      onSelect()
    }
  }
  node.addEventListener('click', click)
  node.addEventListener('keydown', keydown)
  let position: Monaco.editor.IContentWidgetPosition | null = null
  const widget: Monaco.editor.IContentWidget = {
    getId: () => `localix.inlineBlame.${editor.getId()}`,
    getDomNode: () => node,
    getPosition: () => position,
    suppressMouseDown: true,
  }
  editor.addContentWidget(widget)

  return {
    set(lineNumber?: number, text?: string, action?: () => void): void {
      onSelect = action
      node.classList.toggle('localix-monaco-inline-blame-action', !!action)
      node.tabIndex = action ? 0 : -1
      if (action) {
        node.setAttribute('role', 'button')
        node.setAttribute('aria-label', `Open commit diff: ${text}`)
        node.removeAttribute('aria-hidden')
        node.title = 'Open commit diff'
      } else {
        node.removeAttribute('role')
        node.removeAttribute('aria-label')
        node.setAttribute('aria-hidden', 'true')
        node.title = ''
      }
      position =
        lineNumber !== undefined && text
          ? {
              position: { lineNumber, column: model.getLineMaxColumn(lineNumber) },
              preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
              positionAffinity: monaco.editor.PositionAffinity.Right,
            }
          : null
      node.textContent = text ?? ''
      editor.layoutContentWidget(widget)
    },
    dispose(): void {
      node.removeEventListener('click', click)
      node.removeEventListener('keydown', keydown)
      editor.removeContentWidget(widget)
    },
  }
}
