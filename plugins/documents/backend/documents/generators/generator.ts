/**
 * The single {@link DocumentGenerator} implementation: routes a {@link GenerateFormat}
 * to its encoder (Markdown→docx / Markdown→pdf / rows→xlsx) and derives a sensible
 * output filename. Agnostic — bytes in, bytes out; no media store, chat, or UI.
 */
import { parseMarkdownBlocks, type Block } from '../markdown/blocks'
import { spansToText } from '../markdown/inline'
import { DOCUMENT_MEDIA_TYPES } from '../registry'
import type {
  DocumentGenerator,
  GenerateFormat,
  GenerateInput,
  GeneratedDocument,
} from '../generate-contracts'
import { blocksToDocx } from './docx'
import { blocksToPdf } from './pdf'
import { contentToXlsx } from './xlsx'
import { layoutToPdf } from './layout-pdf'
import { layoutToDocx } from './layout-docx'

/** Default base name per format when neither a hint nor a heading is available. */
const DEFAULT_BASE: Record<GenerateFormat, string> = {
  docx: 'document',
  pdf: 'document',
  xlsx: 'spreadsheet',
}

/** Filesystem-safe slug: lowercase, non-alnum → `-`, trimmed, capped. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** First heading's text, for naming a docx/pdf when no filename hint is given. */
function firstHeadingText(blocks: Block[]): string | undefined {
  const heading = blocks.find((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading')
  return heading ? spansToText(heading.spans) : undefined
}

export function createDocumentGenerator(): DocumentGenerator {
  return {
    async generate(input: GenerateInput): Promise<GeneratedDocument> {
      const { format } = input
      const mediaType = DOCUMENT_MEDIA_TYPES[format]
      const hint = input.filename ? slugify(input.filename.replace(/\.[a-z0-9]+$/i, '')) : ''

      if (format === 'xlsx') {
        const bytes = contentToXlsx(input.content)
        return { bytes, mediaType, suggestedFilename: `${hint || DEFAULT_BASE.xlsx}.xlsx` }
      }

      const blocks = parseMarkdownBlocks(input.content)
      const base = hint || slugify(firstHeadingText(blocks) ?? '') || DEFAULT_BASE[format]
      const bytes =
        format === 'docx'
          ? input.layout
            ? await layoutToDocx(input.layout)
            : await blocksToDocx(blocks)
          : input.layout
            ? await layoutToPdf(input.layout)
            : await blocksToPdf(blocks)
      return { bytes, mediaType, suggestedFilename: `${base}.${format}` }
    },
  }
}
