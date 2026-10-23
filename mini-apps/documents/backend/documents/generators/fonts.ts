import { readFile } from 'node:fs/promises'
import type { DocumentFont } from '@localixai/plugin-sdk/document-layout'
import InterRegular from '../../../assets/fonts/Inter-Regular.ttf' with { type: 'file' }
import InterBold from '../../../assets/fonts/Inter-Bold.ttf' with { type: 'file' }
import InterItalic from '../../../assets/fonts/Inter-Italic.ttf' with { type: 'file' }
import InterBoldItalic from '../../../assets/fonts/Inter-BoldItalic.ttf' with { type: 'file' }
import CarlitoRegular from '../../../assets/fonts/Carlito-Regular.ttf' with { type: 'file' }
import CarlitoBold from '../../../assets/fonts/Carlito-Bold.ttf' with { type: 'file' }
import CarlitoItalic from '../../../assets/fonts/Carlito-Italic.ttf' with { type: 'file' }
import CarlitoBoldItalic from '../../../assets/fonts/Carlito-BoldItalic.ttf' with { type: 'file' }
import ArimoRegular from '../../../assets/fonts/Arimo-Regular.ttf' with { type: 'file' }
import ArimoBold from '../../../assets/fonts/Arimo-Bold.ttf' with { type: 'file' }
import ArimoItalic from '../../../assets/fonts/Arimo-Italic.ttf' with { type: 'file' }
import ArimoBoldItalic from '../../../assets/fonts/Arimo-BoldItalic.ttf' with { type: 'file' }
import RobotoRegular from '../../../assets/fonts/Roboto-Regular.ttf' with { type: 'file' }
import RobotoBold from '../../../assets/fonts/Roboto-Bold.ttf' with { type: 'file' }
import RobotoItalic from '../../../assets/fonts/Roboto-Italic.ttf' with { type: 'file' }
import RobotoBoldItalic from '../../../assets/fonts/Roboto-BoldItalic.ttf' with { type: 'file' }
import OpenSansRegular from '../../../assets/fonts/OpenSans-Regular.ttf' with { type: 'file' }
import OpenSansBold from '../../../assets/fonts/OpenSans-Bold.ttf' with { type: 'file' }
import OpenSansItalic from '../../../assets/fonts/OpenSans-Italic.ttf' with { type: 'file' }
import OpenSansBoldItalic from '../../../assets/fonts/OpenSans-BoldItalic.ttf' with { type: 'file' }
import SourceSans3Regular from '../../../assets/fonts/SourceSans3-Regular.ttf' with { type: 'file' }
import SourceSans3Bold from '../../../assets/fonts/SourceSans3-Bold.ttf' with { type: 'file' }
import SourceSans3Italic from '../../../assets/fonts/SourceSans3-Italic.ttf' with { type: 'file' }
import SourceSans3BoldItalic from '../../../assets/fonts/SourceSans3-BoldItalic.ttf' with { type: 'file' }
import LoraRegular from '../../../assets/fonts/Lora-Regular.ttf' with { type: 'file' }
import LoraBold from '../../../assets/fonts/Lora-Bold.ttf' with { type: 'file' }
import LoraItalic from '../../../assets/fonts/Lora-Italic.ttf' with { type: 'file' }
import LoraBoldItalic from '../../../assets/fonts/Lora-BoldItalic.ttf' with { type: 'file' }
import TinosRegular from '../../../assets/fonts/Tinos-Regular.ttf' with { type: 'file' }
import TinosBold from '../../../assets/fonts/Tinos-Bold.ttf' with { type: 'file' }
import TinosItalic from '../../../assets/fonts/Tinos-Italic.ttf' with { type: 'file' }
import TinosBoldItalic from '../../../assets/fonts/Tinos-BoldItalic.ttf' with { type: 'file' }
import EBGaramondRegular from '../../../assets/fonts/EBGaramond-Regular.ttf' with { type: 'file' }
import EBGaramondBold from '../../../assets/fonts/EBGaramond-Bold.ttf' with { type: 'file' }
import EBGaramondItalic from '../../../assets/fonts/EBGaramond-Italic.ttf' with { type: 'file' }
import EBGaramondBoldItalic from '../../../assets/fonts/EBGaramond-BoldItalic.ttf' with { type: 'file' }
import SourceSerif4Regular from '../../../assets/fonts/SourceSerif4-Regular.ttf' with { type: 'file' }
import SourceSerif4Bold from '../../../assets/fonts/SourceSerif4-Bold.ttf' with { type: 'file' }
import SourceSerif4Italic from '../../../assets/fonts/SourceSerif4-Italic.ttf' with { type: 'file' }
import SourceSerif4BoldItalic from '../../../assets/fonts/SourceSerif4-BoldItalic.ttf' with { type: 'file' }
import MerriweatherRegular from '../../../assets/fonts/Merriweather-Regular.ttf' with { type: 'file' }
import MerriweatherBold from '../../../assets/fonts/Merriweather-Bold.ttf' with { type: 'file' }
import MerriweatherItalic from '../../../assets/fonts/Merriweather-Italic.ttf' with { type: 'file' }
import MerriweatherBoldItalic from '../../../assets/fonts/Merriweather-BoldItalic.ttf' with { type: 'file' }
import GeistMonoRegular from '../../../assets/fonts/GeistMono-Regular.ttf' with { type: 'file' }
import GeistMonoBold from '../../../assets/fonts/GeistMono-Bold.ttf' with { type: 'file' }
import JetBrainsMonoRegular from '../../../assets/fonts/JetBrainsMono-Regular.ttf' with { type: 'file' }
import JetBrainsMonoBold from '../../../assets/fonts/JetBrainsMono-Bold.ttf' with { type: 'file' }
import JetBrainsMonoItalic from '../../../assets/fonts/JetBrainsMono-Italic.ttf' with { type: 'file' }
import JetBrainsMonoBoldItalic from '../../../assets/fonts/JetBrainsMono-BoldItalic.ttf' with { type: 'file' }
import CourierPrimeRegular from '../../../assets/fonts/CourierPrime-Regular.ttf' with { type: 'file' }
import CourierPrimeBold from '../../../assets/fonts/CourierPrime-Bold.ttf' with { type: 'file' }
import CourierPrimeItalic from '../../../assets/fonts/CourierPrime-Italic.ttf' with { type: 'file' }
import CourierPrimeBoldItalic from '../../../assets/fonts/CourierPrime-BoldItalic.ttf' with { type: 'file' }
import IBMPlexMonoRegular from '../../../assets/fonts/IBMPlexMono-Regular.ttf' with { type: 'file' }
import IBMPlexMonoBold from '../../../assets/fonts/IBMPlexMono-Bold.ttf' with { type: 'file' }
import IBMPlexMonoItalic from '../../../assets/fonts/IBMPlexMono-Italic.ttf' with { type: 'file' }
import IBMPlexMonoBoldItalic from '../../../assets/fonts/IBMPlexMono-BoldItalic.ttf' with { type: 'file' }

const files: Record<DocumentFont, string[]> = {
  inter: [InterRegular, InterBold, InterItalic, InterBoldItalic],
  carlito: [CarlitoRegular, CarlitoBold, CarlitoItalic, CarlitoBoldItalic],
  arimo: [ArimoRegular, ArimoBold, ArimoItalic, ArimoBoldItalic],
  roboto: [RobotoRegular, RobotoBold, RobotoItalic, RobotoBoldItalic],
  'open-sans': [OpenSansRegular, OpenSansBold, OpenSansItalic, OpenSansBoldItalic],
  'source-sans-3': [SourceSans3Regular, SourceSans3Bold, SourceSans3Italic, SourceSans3BoldItalic],
  lora: [LoraRegular, LoraBold, LoraItalic, LoraBoldItalic],
  tinos: [TinosRegular, TinosBold, TinosItalic, TinosBoldItalic],
  'eb-garamond': [EBGaramondRegular, EBGaramondBold, EBGaramondItalic, EBGaramondBoldItalic],
  'source-serif-4': [
    SourceSerif4Regular,
    SourceSerif4Bold,
    SourceSerif4Italic,
    SourceSerif4BoldItalic,
  ],
  merriweather: [MerriweatherRegular, MerriweatherBold, MerriweatherItalic, MerriweatherBoldItalic],
  'geist-mono': [GeistMonoRegular, GeistMonoBold, GeistMonoRegular, GeistMonoBold],
  'jetbrains-mono': [
    JetBrainsMonoRegular,
    JetBrainsMonoBold,
    JetBrainsMonoItalic,
    JetBrainsMonoBoldItalic,
  ],
  'courier-prime': [
    CourierPrimeRegular,
    CourierPrimeBold,
    CourierPrimeItalic,
    CourierPrimeBoldItalic,
  ],
  'ibm-plex-mono': [IBMPlexMonoRegular, IBMPlexMonoBold, IBMPlexMonoItalic, IBMPlexMonoBoldItalic],
}
const cache = new Map<string, Promise<Buffer>>()
export function fontBytes(font: DocumentFont, face = 0): Promise<Buffer> {
  const file = files[font][face]
  if (!cache.has(file)) cache.set(file, readFile(new URL(file, import.meta.url)))
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
