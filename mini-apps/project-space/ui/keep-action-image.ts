import { miniAppApiFetch, miniAppApiUrl } from '@localixai/mini-app-sdk/ui/transport'
import { spaceApi } from './api'
import { localPath, webUrl } from './action-target'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** Only Localix media is fetched through the authenticated transport. Remote images stay URLs. */
function mediaRoute(src: string): string | null {
  if (/^\/rpc\/media\/[^/?#]+(?:\?.*)?$/u.test(src)) return src
  try {
    const base = new URL(miniAppApiUrl('/rpc/'))
    const url = new URL(src)
    return url.origin === base.origin && /^\/rpc\/media\/[^/]+$/u.test(url.pathname)
      ? `${url.pathname}${url.search}`
      : null
  } catch {
    return null
  }
}

async function boundedImage(response: Response): Promise<Blob> {
  const type = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!response.ok || !type.startsWith('image/') || !response.body)
    throw new Error('The image could not be read.')
  const reader = response.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) throw new Error('This image is too large to keep on the board.')
      parts.push(new Uint8Array(value))
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return new Blob(parts, { type })
}

export async function keepActionImage(
  sessionId: string,
  src: string,
): Promise<{ path: string } | { url: string }> {
  const route = mediaRoute(src)
  let file: Blob | undefined
  if (route)
    file = await boundedImage(await miniAppApiFetch(route, { signal: AbortSignal.timeout(10000) }))
  else if (/^data:/iu.test(src)) {
    const match = /^data:(image\/[\w.+-]+);base64,([a-z\d+/=\s]+)$/iu.exec(src)
    if (!match || match[2]!.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3))
      throw new Error('This image is invalid or too large to keep on the board.')
    const bytes = Uint8Array.from(atob(match[2]!), (ch) => ch.charCodeAt(0))
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new Error('This image is too large to keep on the board.')
    file = new Blob([bytes], { type: match[1] })
  }
  if (file) {
    const extension =
      file.type.split('/')[1]?.replace('svg+xml', 'svg').replace('jpeg', 'jpg') || 'png'
    return { path: await spaceApi.keepFile(sessionId, file, `image.${extension}`) }
  }
  if (webUrl(src)) return { url: src }
  if (localPath(src)) return { path: src }
  throw new Error('This image source cannot be kept on the board.')
}
