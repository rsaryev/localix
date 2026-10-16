import { apiFetch } from '@/shared/api/internal'
import { platformCapabilities } from './platformCapabilities'

/**
 * Copy an image to the clipboard AS AN IMAGE.
 *
 * `src` is either a base64 data URL (an inline attachment — the composer stages
 * anything under 50KB that way) or the served `/rpc/media/:id` URL. `fetch`
 * handles both, so this is storage-agnostic and every caller can pass whatever
 * `mediaSrc()` produced.
 *
 * Why this must exist next to every image the user can see: with no copy
 * affordance the only way to copy a picture is to select it and press ⌘C, and
 * for an inline attachment the browser then puts the `<img>`'s `src` — the whole
 * `data:image/png;base64,…` string — on the clipboard as TEXT. Pasting that
 * elsewhere yields a wall of base64 instead of the picture. This was reported
 * from the chat, where user-attached images had a lightbox and a download link
 * but no copy, while model-generated images beside them had one.
 *
 * Throws on a transport failure; returns `false` when the clipboard refused.
 * The caller decides what the person is told.
 */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  const res = await apiFetch(src)
  let blob = await res.blob()
  // The Clipboard API only reliably accepts image/png — re-encode others via canvas.
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!png) return false
    blob = png
  }
  return await platformCapabilities().clipboard.writeBlob(blob, 'image/png')
}
