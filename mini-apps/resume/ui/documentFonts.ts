import { miniAppApiUrl } from '@localixai/mini-app-sdk/ui/transport'
import type { DocumentFont } from '@localixai/mini-app-sdk/document-layout'
const loaded = new Map<DocumentFont, Promise<void>>()
export function ensureDocumentFont(font: DocumentFont): Promise<void> {
  if (typeof FontFace === 'undefined') return Promise.resolve()
  if (!loaded.has(font))
    loaded.set(
      font,
      Promise.all(
        [0, 1, 2, 3].map(async (face) => {
          const entry = new FontFace(
            `LocalixDocument-${font}`,
            `url("${miniAppApiUrl(`/rpc/documents/font/${font}/${face}`)}")`,
            {
              weight: face % 2 ? '700' : '400',
              style: face >= 2 ? 'italic' : 'normal',
            },
          )
          await entry.load()
          document.fonts.add(entry)
        }),
      )
        .then(() => {})
        .catch((error) => {
          loaded.delete(font)
          throw error
        }),
    )
  return loaded.get(font)!
}
