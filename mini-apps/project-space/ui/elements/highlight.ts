import { highlightCode } from '@localixai/kit/code-block'
import { sequenceLineTokens, type SequenceTokenKind } from '../../shared/types/sequence-text'

/**
 * The board's highlighters, one per kind of text it shows — each returning escaped HTML coloured
 * with the host's syntax palette (the `--sh-*` variables `CODE_VIEWER_HIGHLIGHT` sets), so a
 * snippet, a file preview and a diagram's Mermaid read in the colours of the app's editor.
 */

/** Typing is coloured synchronously, so it takes sugar-high's grammars; others type plain. */
export const codeHighlighter = (language: string | undefined) => (text: string) =>
  highlightCode(text, language)

const SEQUENCE_COLOUR: Record<SequenceTokenKind, string | null> = {
  keyword: 'var(--sh-keyword)',
  name: 'var(--sh-class)',
  arrow: 'var(--sh-sign)',
  label: 'var(--sh-string)',
  comment: 'var(--sh-comment)',
  plain: null,
}

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function highlightSequence(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      sequenceLineTokens(line)
        .map(({ text: part, kind }) => {
          const colour = SEQUENCE_COLOUR[kind]
          return colour ? `<span style="color:${colour}">${escape(part)}</span>` : escape(part)
        })
        .join(''),
    )
    .join('\n')
}
