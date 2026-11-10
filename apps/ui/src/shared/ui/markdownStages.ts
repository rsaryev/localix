/**
 * The parts of `llx-markdown` a page fetches the first time a document needs them. Each loader is
 * a module constant: `<Markdown>` keeps what a loader brought, by the loader, so a new function on
 * every render would load again.
 */

/** KaTeX and its stylesheet, for a document with `$…$`. */
export const loadMath = () =>
  import('katex/dist/katex.min.css').then(() => import('llx-markdown/math'))

/** Mermaid, for a ```mermaid fence; drawn one diagram at a time (`llx-markdown/mermaid`). */
export const loadMermaid = () => import('mermaid')
