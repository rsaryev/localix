import type * as Monaco from 'monaco-editor'

/**
 * Monaco's opaque sticky background becomes a black slab over a translucent pane.
 * Adopt the kit's occluder on the native widget so pinned code uses the same material
 * and reduced-transparency fallback as sticky table headers. Widgets can mount lazily.
 */
export function adoptStickyScrollMaterial(editor: Monaco.editor.IStandaloneCodeEditor) {
  const root = editor.getDomNode()
  if (!root) return { dispose() {} }

  const adopt = () => {
    for (const widget of root.querySelectorAll('.sticky-widget')) {
      widget.classList.add('lx-occluder')
    }
  }
  adopt()
  const observer = new MutationObserver(adopt)
  observer.observe(root, { childList: true, subtree: true })
  return { dispose: () => observer.disconnect() }
}
