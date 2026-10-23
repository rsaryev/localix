import type {
  DocumentFont,
  DocumentParagraph,
  DocumentRun,
} from '@localixai/mini-app-sdk/document-layout'
import { fontBytes } from './fonts'
interface CoverageFont {
  hasGlyphForCodePoint(code: number): boolean
}
const cache = new Map<string, Promise<CoverageFont>>()
async function coverage(font: DocumentFont, face: number): Promise<CoverageFont> {
  const key = `${font}-${face}`
  if (!cache.has(key))
    cache.set(
      key,
      import('fontkit').then(
        async ({ create }) => create(await fontBytes(font, face)) as CoverageFont,
      ),
    )
  return cache.get(key)!
}
/** Fonts with a smaller script repertoire fall back per character to embedded Inter. */
export async function coveredParagraph(p: DocumentParagraph): Promise<DocumentParagraph> {
  const runs: DocumentRun[] = []
  for (const run of p.runs) {
    const font = run.font ?? p.font
    const face = (run.bold ? 1 : 0) + (run.italic ? 2 : 0)
    const selected = await coverage(font, face)
    const fallback = await coverage('inter', face)
    let segment = ''
    let activeFont = font
    for (const character of run.text) {
      const code = character.codePointAt(0)!
      const nextFont = /\s/u.test(character) || selected.hasGlyphForCodePoint(code) ? font : 'inter'
      if (nextFont === 'inter' && !/\s/u.test(character) && !fallback.hasGlyphForCodePoint(code))
        throw new Error(
          `No bundled font can render “${character}” (U+${code.toString(16).toUpperCase()}). Choose text supported by the document fonts.`,
        )
      if (nextFont !== activeFont && segment) {
        runs.push({ ...run, font: activeFont, text: segment })
        segment = ''
      }
      activeFont = nextFont
      segment += character
    }
    if (segment) runs.push({ ...run, font: activeFont, text: segment })
  }
  return { ...p, runs }
}
