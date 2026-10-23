import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DocumentFont } from '@localixai/mini-app-sdk/document-layout'

/**
 * The faces of every document font — regular, bold, italic and bold italic — by file name in the
 * app's own `assets/fonts` (licences and sources: `assets/fonts/README.md`).
 *
 * They are read from there at run time, never imported: `import … with { type: 'file' }` made the
 * bundler copy every font into `backend/` a second time, so the packed app carried ~20 MB of
 * byte-identical TTFs twice. `register(ctx)` points this at `ctx.miniAppDir`
 * (`readDocumentFontsFrom`); the source tree is the default, for tests and the source host.
 */
const faces = (family: string, italic = true) =>
  italic
    ? [`${family}-Regular`, `${family}-Bold`, `${family}-Italic`, `${family}-BoldItalic`]
    : [`${family}-Regular`, `${family}-Bold`, `${family}-Regular`, `${family}-Bold`]

const files: Record<DocumentFont, string[]> = {
  inter: faces('Inter'),
  carlito: faces('Carlito'),
  arimo: faces('Arimo'),
  roboto: faces('Roboto'),
  'open-sans': faces('OpenSans'),
  'source-sans-3': faces('SourceSans3'),
  lora: faces('Lora'),
  tinos: faces('Tinos'),
  'eb-garamond': faces('EBGaramond'),
  'source-serif-4': faces('SourceSerif4'),
  merriweather: faces('Merriweather'),
  // Geist Mono has no italic: its upright faces stand in.
  'geist-mono': faces('GeistMono', false),
  'jetbrains-mono': faces('JetBrainsMono'),
  'courier-prime': faces('CourierPrime'),
  'ibm-plex-mono': faces('IBMPlexMono'),
}

/**
 * Where the fonts are, process-wide: the boot load and each per-run load of the backend are
 * separate module instances, and a bundle's chunks share none of one module's state.
 */
const DIR_KEY = Symbol.for('localix.mini-app.documents.fonts-dir')
const SOURCE_APP_DIR = fileURLToPath(new URL('../../../', import.meta.url))
type FontsHolder = { [DIR_KEY]?: string }

/** Read the fonts from the app folder at `appDir` (its `assets/fonts`). */
export function readDocumentFontsFrom(appDir: string): void {
  ;(globalThis as FontsHolder)[DIR_KEY] = join(appDir, 'assets', 'fonts')
}

const fontsDir = () =>
  (globalThis as FontsHolder)[DIR_KEY] ?? join(SOURCE_APP_DIR, 'assets', 'fonts')

const cache = new Map<string, Promise<Buffer>>()
export function fontBytes(font: DocumentFont, face = 0): Promise<Buffer> {
  const file = join(fontsDir(), `${files[font][face]}.ttf`)
  if (!cache.has(file)) cache.set(file, readFile(file))
  return cache.get(file)!
}
/**
 * `PDFDocument`'s `font` option for a document that only draws with the fonts registered here.
 * Left unset, PDFKit opens Helvetica, and its Node build loads that through a runtime `require`
 * of its own `#standard-fonts/*` import a bundle cannot carry, so a packaged generator failed
 * before it drew anything. `null` opens no font; `registerDocumentFonts` selects regular Inter.
 */
export const NO_STANDARD_FONT = null as unknown as string

export async function registerDocumentFonts(doc: PDFKit.PDFDocument, fonts: DocumentFont[]) {
  for (const font of new Set([...fonts, 'inter', 'jetbrains-mono'] as DocumentFont[]))
    for (let face = 0; face < 4; face++)
      doc.registerFont(`${font}-${face}`, await fontBytes(font, face))
  // The document opens on regular Inter; see NO_STANDARD_FONT.
  doc.font('inter-0')
}
