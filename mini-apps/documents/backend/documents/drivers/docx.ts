/// <reference path="./vendor.d.ts" />
/**
 * DOCX driver — Word documents to Markdown. `mammoth` converts the .docx into clean
 * semantic HTML (headings, lists, tables), then `turndown` (+ the GFM mini app for
 * pipe tables) renders that HTML as Markdown the model reads directly.
 *
 * Both heavy libs load via dynamic `import()` on first extraction, so the docx
 * parser never loads at boot.
 */
import type { DocumentConverter, DocumentInput, ExtractedTextDocument } from '../contracts'

/** CommonJS/ESM interop: unwrap a `default` when the lib is `export =`. */
function unwrap<T = unknown>(mod: unknown): T {
  const m = mod as { default?: unknown }
  return (m?.default ? m.default : mod) as T
}

export function createDocxConverter(): DocumentConverter {
  return {
    async extract(input: DocumentInput): Promise<ExtractedTextDocument> {
      const mammothMod = await import('mammoth')
      const mammoth = unwrap<{
        convertToHtml: (i: { buffer: Buffer }) => Promise<{ value: string }>
      }>(mammothMod)
      const TurndownService = unwrap<
        new (o?: Record<string, unknown>) => {
          turndown: (html: string) => string
          use: (p: unknown) => unknown
        }
      >(await import('turndown'))
      const gfmMod = (await import('turndown-plugin-gfm')) as {
        gfm?: unknown
        default?: { gfm?: unknown }
      }
      const gfm = gfmMod.gfm ?? gfmMod.default?.gfm

      const { value: html } = await mammoth.convertToHtml({ buffer: input.bytes })
      // An empty (or image-only) document still succeeds with a blank body — an empty
      // extraction is not an error; the caller decides what to do with it.
      let markdown = ''
      if (html.trim()) {
        const td = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
        })
        if (gfm) td.use(gfm)
        markdown = td.turndown(html).trim()
      }

      return {
        kind: 'text',
        markdown,
        metadata: { format: 'docx', sourceMediaType: input.mediaType },
      }
    },
  }
}
