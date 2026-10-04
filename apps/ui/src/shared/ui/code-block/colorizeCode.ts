import { monacoLanguageId } from '../code-editor/language'
import { loadMonaco } from '../code-editor/monaco/runtime'
import { defineLocalixMonacoTheme } from '../code-editor/monaco/theme'
import { hasHighlightGrammar, highlightCode } from './highlightCode'

/**
 * Colour any language the app can edit, for a surface that only SHOWS code (a board's file card).
 *
 * `highlightCode` is synchronous and small, but sugar-high has grammars for a handful of languages;
 * an HTML, JSON, YAML, Markdown or shell file came out as plain text. Monaco — already the app's
 * editor, loaded on demand — tokenizes every language it edits, and `editor.colorize` turns that
 * into static HTML without mounting an editor, so none of an editor's layout (which misreads the
 * pointer under a zoomed canvas) is involved. A language sugar-high knows still takes that path:
 * the same colours as the chat's code blocks, and no editor bundle loaded for a `.ts` card.
 *
 * Both paths colour with the `--syntax-code-*` tokens (Monaco's theme is built from them), so a
 * card reads like the file open in the editor. Resolves to escaped HTML; lines end with `<br/>` on
 * the Monaco path, which a `whitespace-pre` block draws the same as a newline.
 */
export async function colorizeCode(code: string, language: string | undefined): Promise<string> {
  if (!language || hasHighlightGrammar(language)) return highlightCode(code, language)
  const monaco = await loadMonaco()
  // colorize paints with the ACTIVE theme's token classes; defining and setting ours injects them
  // (an open editor already runs the same theme, so this changes nothing it shows).
  monaco.editor.setTheme(defineLocalixMonacoTheme(monaco))
  return monaco.editor.colorize(code, monacoLanguageId(language), { tabSize: 2 })
}
